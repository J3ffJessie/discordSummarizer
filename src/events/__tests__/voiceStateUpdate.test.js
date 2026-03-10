const EventEmitter = require('events');

// Build a mock client with the voiceStateUpdate event listener registered
function buildClient({ messageStats = null } = {}) {
  const client = new EventEmitter();
  client.services = { messageStats };
  require('../voiceStateUpdate')(client);
  return client;
}

function makeState({ channelId = null, userId = 'user1', isBot = false } = {}) {
  return {
    channelId,
    member: {
      user: { id: userId, bot: isBot },
    },
  };
}

describe('voiceStateUpdate event', () => {
  let mockStats;
  let client;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    mockStats = { recordVoiceMinutes: jest.fn() };
    client = buildClient({ messageStats: mockStats });
  });

  it('should track when a user joins a voice channel', () => {
    const oldState = makeState({ channelId: null });
    const newState = makeState({ channelId: 'vc1' });

    // Join should not immediately call recordVoiceMinutes
    client.emit('voiceStateUpdate', oldState, newState);
    expect(mockStats.recordVoiceMinutes).not.toHaveBeenCalled();
  });

  it('should record voice minutes when a user leaves', () => {
    jest.useFakeTimers();
    const userId = 'user1';
    const joinTime = Date.now();

    // Join first
    client.emit('voiceStateUpdate',
      makeState({ channelId: null, userId }),
      makeState({ channelId: 'vc1', userId })
    );

    // Advance time by 5 minutes
    jest.advanceTimersByTime(5 * 60 * 1000);

    // Leave
    client.emit('voiceStateUpdate',
      makeState({ channelId: 'vc1', userId }),
      makeState({ channelId: null, userId })
    );

    expect(mockStats.recordVoiceMinutes).toHaveBeenCalledTimes(1);
    const minutes = mockStats.recordVoiceMinutes.mock.calls[0][0];
    expect(minutes).toBeGreaterThanOrEqual(4.9);
    expect(minutes).toBeLessThanOrEqual(5.1);

    jest.useRealTimers();
  });

  it('should record voice minutes when a user switches channels', () => {
    jest.useFakeTimers();
    const userId = 'user2';

    // Join channel A
    client.emit('voiceStateUpdate',
      makeState({ channelId: null, userId }),
      makeState({ channelId: 'vcA', userId })
    );

    // Advance 3 minutes
    jest.advanceTimersByTime(3 * 60 * 1000);

    // Switch to channel B
    client.emit('voiceStateUpdate',
      makeState({ channelId: 'vcA', userId }),
      makeState({ channelId: 'vcB', userId })
    );

    expect(mockStats.recordVoiceMinutes).toHaveBeenCalledTimes(1);
    const minutes = mockStats.recordVoiceMinutes.mock.calls[0][0];
    expect(minutes).toBeCloseTo(3, 0);

    jest.useRealTimers();
  });

  it('should restart the timer after switching channels', () => {
    jest.useFakeTimers();
    const userId = 'user3';

    // Join channel A
    client.emit('voiceStateUpdate',
      makeState({ channelId: null, userId }),
      makeState({ channelId: 'vcA', userId })
    );

    jest.advanceTimersByTime(2 * 60 * 1000);

    // Switch to channel B
    client.emit('voiceStateUpdate',
      makeState({ channelId: 'vcA', userId }),
      makeState({ channelId: 'vcB', userId })
    );

    jest.advanceTimersByTime(4 * 60 * 1000);

    // Leave B
    client.emit('voiceStateUpdate',
      makeState({ channelId: 'vcB', userId }),
      makeState({ channelId: null, userId })
    );

    expect(mockStats.recordVoiceMinutes).toHaveBeenCalledTimes(2);
    const firstMinutes = mockStats.recordVoiceMinutes.mock.calls[0][0];
    const secondMinutes = mockStats.recordVoiceMinutes.mock.calls[1][0];
    expect(firstMinutes).toBeCloseTo(2, 0);
    expect(secondMinutes).toBeCloseTo(4, 0);

    jest.useRealTimers();
  });

  it('should ignore bot users', () => {
    const oldState = makeState({ channelId: null, userId: 'bot1', isBot: true });
    const newState = makeState({ channelId: 'vc1', userId: 'bot1', isBot: true });

    client.emit('voiceStateUpdate', oldState, newState);

    // No join tracked, so leave later should not call recordVoiceMinutes
    const leaveOld = makeState({ channelId: 'vc1', userId: 'bot1', isBot: true });
    const leaveNew = makeState({ channelId: null, userId: 'bot1', isBot: true });
    client.emit('voiceStateUpdate', leaveOld, leaveNew);

    expect(mockStats.recordVoiceMinutes).not.toHaveBeenCalled();
  });

  it('should not record voice minutes if user leaves without having joined (no join time tracked)', () => {
    const userId = 'user4';

    // Leave without prior join event
    client.emit('voiceStateUpdate',
      makeState({ channelId: 'vc1', userId }),
      makeState({ channelId: null, userId })
    );

    expect(mockStats.recordVoiceMinutes).not.toHaveBeenCalled();
  });

  it('should not crash when messageStats is unavailable', () => {
    jest.resetModules();
    const clientNoStats = new EventEmitter();
    clientNoStats.services = {}; // no messageStats
    require('../voiceStateUpdate')(clientNoStats);

    expect(() => {
      clientNoStats.emit('voiceStateUpdate',
        makeState({ channelId: 'vc1' }),
        makeState({ channelId: null })
      );
    }).not.toThrow();
  });
});
