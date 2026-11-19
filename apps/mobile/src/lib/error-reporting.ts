/**
 * Error-reporting hook. A crash reporter (e.g. Sentry React Native) is NOT installed yet;
 * register one here when chosen. Reports must never include tokens, prompts or personal data.
 */
type Reporter = (error: unknown, context?: Record<string, string>) => void;

let reporter: Reporter | undefined;

export const registerErrorReporter = (fn: Reporter): void => {
  reporter = fn;
};

export const reportError = (error: unknown, context?: Record<string, string>): void => {
  if (reporter) reporter(error, context);
  else if (__DEV__) console.warn('[karen] unreported error', error); // eslint-disable-line no-console
};
