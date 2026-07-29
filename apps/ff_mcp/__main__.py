from .server import mcp


def main():
    # streamable-http is the only transport this service supports: it exists to be
    # reached through FibreFlow's edge proxy, not over stdio.
    mcp.run(transport="streamable-http")


if __name__ == "__main__":
    main()
