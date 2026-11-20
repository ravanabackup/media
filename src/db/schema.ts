import { doublePrecision, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * One row per channel ("room"). Holds the last playback state reported by the
 * device that is currently the source, so a freshly opened page (or a restarted
 * server) can show what is playing straight away.
 */
export const playbackState = pgTable("playback_state", {
  room: text("room").primaryKey(),
  mediaId: text("media_id").notNull(),
  status: text("status").notNull(),
  position: doublePrecision("position").notNull().default(0),
  duration: doublePrecision("duration").notNull().default(0),
  rate: doublePrecision("rate").notNull().default(1),
  deviceId: text("device_id").notNull(),
  deviceName: text("device_name").notNull(),
  deviceKind: text("device_kind").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
});
