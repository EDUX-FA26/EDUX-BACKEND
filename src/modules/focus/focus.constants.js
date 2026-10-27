/** Danh mục phòng học & âm thanh — BE là nguồn duy nhất, FE nhận qua GET /api/focus/preferences. */
const BACKGROUNDS = [
  { id: 'cottage', name: 'Cottage ấm cúng' },
  { id: 'forest', name: 'Rừng sương sớm' },
  { id: 'rainy-window', name: 'Cửa sổ ngày mưa' },
  { id: 'cafe', name: 'Quán cà phê' },
  { id: 'night-desk', name: 'Bàn học ban đêm' },
];

const SOUNDS = [
  { id: 'rain', name: 'Tiếng mưa' },
  { id: 'forest', name: 'Rừng & chim hót' },
  { id: 'cafe', name: 'Quán cà phê' },
  { id: 'lofi', name: 'Nhạc không lời' },
];

const BACKGROUND_IDS = BACKGROUNDS.map((b) => b.id);
const SOUND_IDS = SOUNDS.map((s) => s.id);

const DEFAULT_POMODORO = Object.freeze({
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
});

const DEFAULT_PREFERENCES = Object.freeze({
  backgroundId: 'cottage',
  masterVolume: 0.8,
  sounds: SOUND_IDS.map((id) => ({ id, enabled: false, volume: 0.5 })),
  ...DEFAULT_POMODORO,
  autoStartNext: false,
});

const TIMEZONE = 'Asia/Ho_Chi_Minh';

module.exports = {
  BACKGROUNDS,
  SOUNDS,
  BACKGROUND_IDS,
  SOUND_IDS,
  DEFAULT_POMODORO,
  DEFAULT_PREFERENCES,
  TIMEZONE,
};

