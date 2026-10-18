/** TV quiet hours use the host's local clock, just like Task schedules. */
import { HttpError } from './storage.mjs';

export const defaultDoNotDisturb = {
  enabled: false,
  scheduleEnabled: false,
  days: [1, 2, 3, 4, 5, 6, 0],
  start: '22:00',
  end: '07:00',
};

export function validateDoNotDisturb(value) {
  const keys = ['enabled', 'scheduleEnabled', 'days', 'start', 'end'];
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !keys.includes(key))
    || typeof value.enabled !== 'boolean' || typeof value.scheduleEnabled !== 'boolean'
    || !Array.isArray(value.days) || value.days.length < 1 || value.days.length > 7
    || value.days.some(day => !Number.isInteger(day) || day < 0 || day > 6)
    || new Set(value.days).size !== value.days.length
    || ![value.start, value.end].every(time => typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    || value.start === value.end) {
    throw new HttpError(400, 'Choose at least one day and different valid start and end times for Do not disturb.');
  }
  return value;
}

export function doNotDisturbStatus(value = defaultDoNotDisturb, date = new Date()) {
  const minute = date.getHours() * 60 + date.getMinutes();
  const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const start = minutes(value.start), end = minutes(value.end);
  const today = date.getDay(), yesterday = (today + 6) % 7;
  // Days select when a window starts. Monday 22:00–07:00 includes Tuesday
  // morning, not Monday morning. End is exclusive, including overnight windows.
  const inWindow = start < end
    ? value.days.includes(today) && minute >= start && minute < end
    : (value.days.includes(today) && minute >= start) || (value.days.includes(yesterday) && minute < end);
  const scheduled = value.scheduleEnabled && inWindow;
  return { active: value.enabled || scheduled, manual: value.enabled, scheduled };
}

export function isTvAction(pluginId, actionId) {
  // Read-only refreshes remain available; Samsung effects
  // default to protected. Webpage's delegation is protected before its DNS read.
  return pluginId === 'samsung-tv' && !['refresh', 'refresh-apps'].includes(actionId)
    || pluginId === 'webpage' && actionId === 'open-on-tv';
}

export function tvDoNotDisturbError() {
  return Object.assign(new HttpError(409, 'Do not disturb: automatic TV action skipped.'), { code: 'TV_DO_NOT_DISTURB' });
}
