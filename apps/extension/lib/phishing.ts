export const PHISHING_ALARM = 'clef-phishing-refresh';
const DAY_MINUTES = 24 * 60;

export interface PhishingAlarms {
  get(name: string): Promise<unknown>;
  create(name: string, info: { delayInMinutes: number; periodInMinutes: number }): Promise<void> | void;
  onAlarm: { addListener(cb: (alarm: { name: string }) => void): void };
}

/**
 * Daily refresh of the phishing list (wallet-core's PhishingListStore validates and stores it). The alarm survives
 * service-worker restarts: create it once, re-attach the listener on every start.
 */
export async function schedulePhishingRefresh(
  alarms: PhishingAlarms,
  list: { refresh(): Promise<void> },
  onError: (e: unknown) => void,
): Promise<void> {
  alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === PHISHING_ALARM) list.refresh().catch(onError);
  });
  if (!(await alarms.get(PHISHING_ALARM))) await alarms.create(PHISHING_ALARM, { delayInMinutes: 1, periodInMinutes: DAY_MINUTES });
}
