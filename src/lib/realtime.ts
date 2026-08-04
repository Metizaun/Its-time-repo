let realtimeChannelSequence = 0;

export function createRealtimeChannelName(baseName: string) {
  realtimeChannelSequence += 1;
  return `${baseName}:${Date.now().toString(36)}:${realtimeChannelSequence.toString(36)}`;
}
