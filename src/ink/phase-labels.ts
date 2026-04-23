import type { FlowMode } from '../types.js';

export interface PhaseSlot {
  key: string;
  label: string;
}

export function getFullFlowSlots(): PhaseSlot[] {
  return [
    { key: '1', label: 'Spec 작성' },
    { key: '2', label: 'Spec Gate' },
    { key: '3', label: 'Plan 작성' },
    { key: '4', label: 'Plan Gate' },
    { key: '5', label: '구현' },
    { key: '6', label: '검증' },
    { key: '7', label: 'Eval Gate' },
  ];
}

export function getLightFlowSlots(): PhaseSlot[] {
  return [
    { key: '1', label: '설계+플랜' },
    { key: '2', label: 'Spec Gate' },
    { key: '5', label: '구현' },
    { key: '6', label: '검증' },
    { key: '7', label: 'Eval Gate' },
  ];
}

export function getSlots(flow: FlowMode): PhaseSlot[] {
  return flow === 'light' ? getLightFlowSlots() : getFullFlowSlots();
}

export function phaseLabel(key: string, flow: FlowMode): string {
  const slot = getSlots(flow).find(s => s.key === key);
  return slot?.label ?? `Phase ${key}`;
}
