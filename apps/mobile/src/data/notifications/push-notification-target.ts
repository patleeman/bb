import { getThreadRoutePath } from "@bb/client-core";
import { z } from "zod";
import {
  matchProfileForWebLink,
  type LinkProfileLike,
} from "@/lib/links/incoming-link";

export interface PushNotificationTarget {
  threadId: string | null;
  projectId: string | null;
  serverUrl: string | null;
  path?: string;
}

const pushDataSchema = z
  .object({
    threadId: z.string().min(1).nullish(),
    path: z
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
      )
      .optional(),
    projectId: z.string().min(1).nullish(),
    serverUrl: z.string().min(1).nullish(),
    url: z.string().min(1).nullish(),
  })
  .refine((value) => value.threadId != null || value.path !== undefined);

function normalizedHint(value: string, preservePath: boolean): string | null {
  try {
    const url = new URL(value);
    if (!preservePath || url.pathname === "/") return url.origin;
    return `${url.origin}${url.pathname.replace(/\/+$/u, "")}`;
  } catch {
    return null;
  }
}

export function parsePushNotificationData(
  data: unknown,
): PushNotificationTarget | null {
  const parsed = pushDataSchema.safeParse(data);
  if (!parsed.success) return null;
  const serverUrl = parsed.data.serverUrl ?? null;
  const fallbackUrl = parsed.data.url ?? null;
  return {
    threadId: parsed.data.threadId ?? null,
    ...(parsed.data.path ? { path: parsed.data.path } : {}),
    projectId: parsed.data.projectId ?? null,
    serverUrl: serverUrl
      ? normalizedHint(serverUrl, true)
      : fallbackUrl
        ? normalizedHint(fallbackUrl, false)
        : null,
  };
}

export interface ResolvePushTargetProfileDeps {
  profiles: readonly LinkProfileLike[];
  activeProfileId: string | null;
  hasThread(serverUrl: string, threadId: string): Promise<boolean>;
}

export async function resolvePushTargetProfile(
  target: PushNotificationTarget,
  deps: ResolvePushTargetProfileDeps,
): Promise<LinkProfileLike | null> {
  const { profiles } = deps;
  if (profiles.length === 0) return null;
  if (target.serverUrl) {
    try {
      const hint = new URL(target.serverUrl);
      const match = matchProfileForWebLink(
        profiles,
        hint.origin,
        hint.pathname,
      );
      if (match) return match.profile;
    } catch {}
  }
  if (target.threadId === null) return null;
  const ordered = [
    ...profiles.filter((profile) => profile.id === deps.activeProfileId),
    ...profiles.filter((profile) => profile.id !== deps.activeProfileId),
  ];
  for (const profile of ordered) {
    try {
      if (await deps.hasThread(profile.serverUrl, target.threadId)) {
        return profile;
      }
    } catch {}
  }
  return null;
}

export function pushNotificationRoute(target: PushNotificationTarget): string {
  if (target.path) return target.path;
  if (!target.threadId) throw new Error("Notification has no destination");
  return target.projectId === null
    ? `/threads/${encodeURIComponent(target.threadId)}`
    : getThreadRoutePath({
        projectId: target.projectId,
        threadId: target.threadId,
      });
}
