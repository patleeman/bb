import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const DEFAULT_EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
export const EXPO_PUSH_TOKEN_MAX_LENGTH = 512;
export const DEVICE_LABEL_MAX_LENGTH = 120;

export const notificationKindPriority = [
  "pending-interaction",
  "thread-error",
  "turn-finished",
] as const;
export const subscriptionServerUrlSchema = z
  .string()
  .url()
  .refine((value) => ["http:", "https:"].includes(new URL(value).protocol));

export const pushPlatformSchema = z.enum(["ios", "android"]);

export const pushSubscriptionSchema = z
  .object({
    id: z.string().min(1),
    expoPushToken: z.string().min(1).max(EXPO_PUSH_TOKEN_MAX_LENGTH),
    platform: pushPlatformSchema,
    serverUrl: subscriptionServerUrlSchema.optional(),
    deviceLabel: z.string().min(1).max(DEVICE_LABEL_MAX_LENGTH),
    createdAt: z.number().int().nonnegative(),
    lastSeenAt: z.number().int().nonnegative(),
  })
  .strict();

export const pushSubscriptionSummarySchema = pushSubscriptionSchema
  .omit({ expoPushToken: true, serverUrl: true })
  .extend({ tokenSuffix: z.string().min(1).max(6) })
  .strict();

export const addPushSubscriptionInputSchema = z
  .object({
    expoPushToken: z.string().trim().min(1).max(EXPO_PUSH_TOKEN_MAX_LENGTH),
    platform: pushPlatformSchema,
    serverUrl: subscriptionServerUrlSchema.optional(),
    deviceLabel: z.string().trim().min(1).max(DEVICE_LABEL_MAX_LENGTH),
  })
  .strict();

export const removePushSubscriptionInputSchema = z
  .object({ id: z.string().min(1) })
  .strict();

export const pluginNotificationPathSchema = z
  .string()
  .regex(
    /^\/plugins\/[a-z0-9][a-z0-9-]*\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_%:.-]+)*$/u,
  )
  .refine((path) =>
    path
      .split("/")
      .every(
        (part) =>
          part !== "." && part !== ".." && !/%(?:2e|2f|5c)/iu.test(part),
      ),
  );
export const sourceNotificationSchema = z
  .object({
    title: z.string(),
    body: z.string(),
    kind: z.enum(["turn-finished", "thread-error", "pending-interaction"]),
    threadId: z.string().min(1).nullable(),
    projectId: z.string().min(1),
    path: pluginNotificationPathSchema.optional(),
    coalesceKey: z.string().min(1).max(300).optional(),
  })
  .strict()
  .refine((value) => value.threadId !== null || value.path !== undefined);
export type SourceNotification = z.infer<typeof sourceNotificationSchema>;
export const enqueueNotificationSchema = z
  .object({
    pluginId: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]*$/u)
      .max(100),
    eventId: z.string().min(1).max(300),
  })
  .strict();

export const clientChannelSchema = z.enum(["web", "desktop"]);
export const CLIENT_NOTIFICATION_CHANNEL = "notification";
export const clientNotificationSchema = z
  .object({
    id: z.string().min(1),
    title: z.string(),
    body: z.string(),
    threadId: z.string().nullable(),
    path: pluginNotificationPathSchema.optional(),
    channels: z.array(clientChannelSchema),
    groupId: z.string().optional(),
  })
  .strict();
export type ClientNotification = z.infer<typeof clientNotificationSchema>;

const emptyInputSchema = z.object({}).strict();
export const listPushSubscriptionsOutputSchema = z
  .object({ subscriptions: z.array(pushSubscriptionSummarySchema) })
  .strict();

export const pushNotificationsRpcContract = defineRpcContract({
  "notifications.enqueue": {
    input: enqueueNotificationSchema,
    output: z.object({ ok: z.literal(true) }).strict(),
  },
  "notifications.test": {
    input: z.object({ channel: clientChannelSchema }).strict(),
    output: z.object({ ok: z.literal(true) }).strict(),
  },
  "pushSubscriptions.list": {
    input: emptyInputSchema,
    output: listPushSubscriptionsOutputSchema,
  },
  "pushSubscriptions.add": {
    input: addPushSubscriptionInputSchema,
    output: z.object({ id: z.string().min(1), created: z.boolean() }).strict(),
  },
  "pushSubscriptions.remove": {
    input: removePushSubscriptionInputSchema,
    output: z.object({ ok: z.literal(true) }).strict(),
  },
});

export type PushSubscription = z.infer<typeof pushSubscriptionSchema>;
export type PushSubscriptionSummary = z.infer<
  typeof pushSubscriptionSummarySchema
>;
export type AddPushSubscriptionInput = z.infer<
  typeof addPushSubscriptionInputSchema
>;
