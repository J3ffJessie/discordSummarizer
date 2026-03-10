jest.mock('axios');

const axios = require('axios');
const { fetchUpcomingEvents } = require('../events');

describe('fetchUpcomingEvents', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return sorted events on success', async () => {
    const mockEvents = [
      { name: 'Event B', startTime: '2026-03-15T10:00:00Z' },
      { name: 'Event A', startTime: '2026-03-10T08:00:00Z' },
    ];
    axios.get.mockResolvedValue({ data: mockEvents });

    const result = await fetchUpcomingEvents();

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Event A'); // sorted by startTime ascending
    expect(result[1].name).toBe('Event B');
  });

  it('should call the Luma API endpoint', async () => {
    axios.get.mockResolvedValue({ data: [] });

    await fetchUpcomingEvents();

    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining('luma.com'),
      expect.objectContaining({ timeout: 8000 })
    );
  });

  it('should pass the LUMA_API_KEY header', async () => {
    process.env.LUMA_API_KEY = 'test-key-123';
    axios.get.mockResolvedValue({ data: [] });

    await fetchUpcomingEvents();

    expect(axios.get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-luma-api-key': 'test-key-123' }),
      })
    );

    delete process.env.LUMA_API_KEY;
  });

  it('should return empty array on API error', async () => {
    axios.get.mockRejectedValue(new Error('Network error'));

    const result = await fetchUpcomingEvents();

    expect(result).toEqual([]);
  });

  it('should return empty array on empty response', async () => {
    axios.get.mockResolvedValue({ data: [] });

    const result = await fetchUpcomingEvents();

    expect(result).toEqual([]);
  });
});
