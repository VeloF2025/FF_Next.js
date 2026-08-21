import { describe, it, expect } from 'vitest';
import { classifyVlmHealth, buildVlmAlert, isAlerting, sanitizeHeader } from './monitor';

describe('classifyVlmHealth', () => {
  it('reports healthy when a model id is present', () => {
    const status = classifyVlmHealth('QuantTrio/Qwen3-VL-30B-A3B-Instruct-AWQ');
    expect(status.verdict).toBe('healthy');
    expect(status.modelId).toBe('QuantTrio/Qwen3-VL-30B-A3B-Instruct-AWQ');
  });

  it('classifies a failed probe as unreachable, not a healthy default', () => {
    const status = classifyVlmHealth(null);
    expect(status.verdict).toBe('unreachable');
    expect(status.modelId).toBeNull();
  });
});

describe('isAlerting', () => {
  it('alerts only on unreachable', () => {
    expect(isAlerting('unreachable')).toBe(true);
    expect(isAlerting('healthy')).toBe(false);
  });
});

describe('sanitizeHeader', () => {
  it('strips CR/LF so a value cannot inject mail headers', () => {
    expect(sanitizeHeader('subject\r\nBcc: attacker@evil.com')).toBe(
      'subject Bcc: attacker@evil.com',
    );
  });
});

describe('buildVlmAlert', () => {
  it('renders nothing when healthy', () => {
    expect(buildVlmAlert(classifyVlmHealth('Qwen3-VL'))).toBeNull();
  });

  it('flags an outage as action-needed with a diagnostic runbook', () => {
    const alert = buildVlmAlert(classifyVlmHealth(null));
    expect(alert).not.toBeNull();
    expect(alert!.subject).toContain('UNREACHABLE');
    expect(alert!.subject).toContain('ACTION NEEDED');
    expect(alert!.text).toContain('vllm-qwen.service');
    // The exact fix for the 2026-08-20 incident this monitor exists to catch.
    expect(alert!.text).toContain('linux-modules-nvidia-580-open');
  });

  it('renders an all-clear with downtime when recovered', () => {
    const alert = buildVlmAlert(classifyVlmHealth('Qwen3-VL'), {
      recovered: true,
      downtimeMs: 23 * 60 * 60 * 1000,
    });
    expect(alert!.subject).toContain('RECOVERED');
    expect(alert!.subject).toContain('1380 min');
  });

  it('renders the all-clear without downtime when duration is unknown', () => {
    const alert = buildVlmAlert(classifyVlmHealth('Qwen3-VL'), { recovered: true });
    expect(alert!.subject).toBe('[FibreFlow] VLM service RECOVERED');
  });
});
