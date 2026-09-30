export type DialerMode = "clipboard" | "url" | "vcdialer";

export type DialerSettings = {
  mode: DialerMode;
  /** Click-to-call handoff, e.g. "https://dialer.example.com/call?to={phone}&ext={extension}" */
  urlTemplate: string;
  /** VC Dialer API credentials, filled in once the client shares API access. */
  vcdialer: { apiBaseUrl: string; apiKey: string; accountId: string };
  /** agent user id -> dialer extension / agent id */
  extensions: Record<string, string>;
};

export type BreakType = { key: string; label: string; maxMinutes: number };

export type EmailSettings = {
  /** Outgoing SMTP server used for follow-up emails. Empty host = sending is switched off. */
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
};

export type AppSettings = {
  companyName: string;
  businessTimezone: string;
  inactivityMinutes: number;
  autoAssignMinutes: number;
  leadPresets: number[];
  maxLeadRequest: number;
  sessionIdleMinutes: number;
  sessionMaxHours: number;
  breakTypes: BreakType[];
  hrDocumentCategories: string[];
  dialer: DialerSettings;
  email: EmailSettings;
  /** Rupees deducted per absent day = basic / this many working days. 0 = use the month's scheduled days. */
  payrollWorkingDays: number;
};

export const DEFAULT_SETTINGS: AppSettings = {
  companyName: "Lone Star Legacy",
  businessTimezone: "America/Chicago",
  inactivityMinutes: 5,
  autoAssignMinutes: 5,
  leadPresets: [15, 30],
  maxLeadRequest: 200,
  sessionIdleMinutes: 30,
  sessionMaxHours: 14,
  breakTypes: [
    { key: "short", label: "Short break", maxMinutes: 15 },
    { key: "meal", label: "Meal break", maxMinutes: 45 },
    { key: "prayer", label: "Prayer break", maxMinutes: 15 },
  ],
  hrDocumentCategories: ["Undertaking", "Agreement", "Warning letter", "Performance review", "ID document", "Other"],
  dialer: {
    mode: "clipboard",
    urlTemplate: "",
    vcdialer: { apiBaseUrl: "", apiKey: "", accountId: "" },
    extensions: {},
  },
  email: { host: "", port: 587, secure: false, user: "", password: "", fromName: "Lone Star Legacy", fromEmail: "", replyTo: "" },
  payrollWorkingDays: 26,
};
