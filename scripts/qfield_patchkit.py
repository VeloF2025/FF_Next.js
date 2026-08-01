"""
Monkeypatch interception for the QField extraction tests — the machinery only.

Kept apart from the fixtures because it is the subtle half. Two properties matter,
and both were learned the hard way:

PATCH BY OBJECT, NOT BY NAME. CPython resolves a function's globals in the module
where it is DEFINED, so when a call site moves the old binding survives as a dangling
import while the live call resolves elsewhere. A `hasattr(known_module, name)` check
still passes, the patch lands on the dead binding, the real MinIO/Postgres function
runs, and the suite still reports PASS. Resolving the object and patching every module
that binds THAT OBJECT closes it: a dangling import is patched harmlessly, a new module
is covered automatically, and there is no registry to go stale.

RESTORE BY SCANNING, NOT BY REPLAY. A call site that lazily imports a NEW module inside
the patched window binds the recording closure there. That module did not exist at
patch time, so replaying the patch-time list would leave it holding a dead stub — after
which the next patch sees two different objects bound to one name and raises on an
unrelated later scenario, or leaks silently if nothing else touches that name.

Zero bindings is an error, never a silent no-op: an unpatched I/O call means the suite
quietly exercises production infrastructure while still reporting green.

WHAT THIS CANNOT CLOSE — read before adding a patched name. Attribute patching only
finds bindings literally named `name`. Any capture-by-value that ALSO renames the call
site escapes it entirely and silently:

    resolve_with_retry = functools.partial(minio_resolve_photo_version)   # captured
    ...
    wrapper_mod.resolve_with_retry(qf, path)     # never resolves the patched name

(Also default-arg capture, decorators, and closures.) Verified: the bare name is
patched while the partial still wraps the real function. No identity scan can fix this
— the object was copied before patching happened.

The backstop is not structural, it is a convention: EVERY patched name has an explicit
`stub_calls[name] > 0` assertion somewhere in the suite — 6 in the interception-guard
group, and the 2 conditional ones (resolve_spatial_pon_map,
minio_resolve_photo_version) in the scenarios that trigger them. That convention is
what actually catches the case above. If you add a 9th patched name, add its assertion
too; the machinery here will not save you.
"""
import os
import sys

SCRIPTS = os.path.dirname(os.path.abspath(__file__))


def script_modules():
    """Every loaded module living in scripts/ — the universe a patched name can hide in.

    Scanned fresh on every call, so a module imported later (or one a future refactor
    adds) is covered without anyone remembering to register it.
    """
    return [m for m in list(sys.modules.values())
            if getattr(m, "__file__", None)
            and os.path.dirname(os.path.abspath(m.__file__)) == SCRIPTS]


class Patcher:
    """Patches names across every module that binds them, and records invocations."""

    def __init__(self, always_scan=()):
        # Modules to scan even when absent from sys.modules. load_extractor() registers
        # under a fixed name, so a second call in one process orphans the first module —
        # in memory, invisible to sys.modules, therefore unscanned and unpatched.
        self._always = list(always_scan)
        self._saved = {}         # name -> [(module, original)]
        self._recordings = {}    # name -> (recording closure, original object)
        self.calls = {}          # name -> times invoked

    def _mods(self):
        mods = script_modules()
        return mods + [m for m in self._always if m not in mods]

    def patch(self, name, fn):
        mods = self._mods()
        bound = {id(getattr(m, name)): getattr(m, name) for m in mods if hasattr(m, name)}
        if not bound:
            raise AssertionError(
                f"{name!r} is bound in no loaded scripts/ module — the harness cannot "
                "intercept it and would silently exercise the real implementation."
            )
        if len(bound) > 1:
            raise AssertionError(
                f"{name!r} is bound to {len(bound)} DIFFERENT objects across modules; "
                "the harness cannot tell which one the code under test will call."
            )
        target = next(iter(bound.values()))

        def recording(*a, **kw):
            self.calls[name] = self.calls.get(name, 0) + 1
            return fn(*a, **kw)

        self._recordings[name] = (recording, target)
        for m in mods:
            if getattr(m, name, None) is target:
                self._saved.setdefault(name, []).append((m, target))
                setattr(m, name, recording)

    def restore(self):
        for name, (recording, original) in self._recordings.items():
            for m in self._mods():
                if getattr(m, name, None) is recording:
                    setattr(m, name, original)
        for name, entries in self._saved.items():
            for mod, orig in entries:
                if getattr(mod, name, None) is not orig:
                    setattr(mod, name, orig)
