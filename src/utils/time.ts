import dayjs, { Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import tz from 'dayjs/plugin/timezone.js';
import { ENV } from '../config/index.js';

dayjs.extend(utc);
dayjs.extend(tz);

export const nowWib = () => dayjs().tz(ENV.TZ);
export const toWib = (iso: string) => dayjs(iso).tz(ENV.TZ);

const parseHHmm = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return { h: h || 0, m: m || 0 };
};

/**
 * Cek apakah d berada di jendela waktu [start, end).
 * Jika end < start → dianggap lintas hari (mis. 23:00–04:00).
 */
export const isInWindowWIB = (d: Dayjs, startHHmm: string, endHHmm: string) => {
  const { h: sh, m: sm } = parseHHmm(startHHmm);
  const { h: eh, m: em } = parseHHmm(endHHmm);

  const start = d.clone().hour(sh).minute(sm).second(0).millisecond(0);
  const end = d.clone().hour(eh).minute(em).second(0).millisecond(0);

  if (end.isBefore(start)) {
    // window lintas hari: [start, 24:00) ∪ [00:00, end)
    return d.isSame(start) || d.isAfter(start) || d.isBefore(end);
  }
  // window normal: [start, end)
  return d.isSame(start) || (d.isAfter(start) && d.isBefore(end));
};

export default dayjs;
