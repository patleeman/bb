Get a notification when an agent asks a question, finishes a turn, or stops on an error. Choose mobile, web, and desktop delivery independently in Settings → Push notifications.

## Delivery

Mobile devices receive push messages through Expo, including when the app is closed. Web browsers and the desktop app receive system notifications over bb’s live connection while a tab or app window remains open. Web delivery requires HTTPS (or localhost), browser notification permission, and a browser that supports the Notification constructor. Closing all bb tabs stops web delivery; quitting the desktop app stops desktop delivery. Mobile WebViews use mobile push only.

Click a notification to open its thread or channel. Channel replies open the message permalink; pending questions and approvals open the work thread. Events arriving together are combined, with pending questions taking priority. Read, archived, deleted, and hidden threads are suppressed. Multiple tabs or windows of the same origin and client type deduplicate delivery when browser storage and Web Locks are available.

## Settings

- `mobileEnabled` / **Mobile notifications**: send to registered phones and tablets. Default: true.
- `webEnabled` / **Web notifications**: notify connected browsers with permission. Default: true.
- `desktopEnabled` / **Desktop notifications**: notify running desktop clients. Default: true.
- `expoPushUrl` / **Expo push relay URL**: mobile relay endpoint. Defaults to `https://exp.host/--/api/v2/push/send`.

Channel switches apply to this server and save immediately. Browser permission is granted separately on each device with **Allow notifications**. If blocked, change the browser or operating system notification settings. **Send test notification** sends to all connected, permitted clients of the current type. A successful test request confirms broadcast, not OS display; system settings and Focus modes can suppress banners.

## CLI and SDK

- `bb push-notifications list [--json]`: registered mobile devices, with redacted tokens.
- `bb push-notifications add --token <expo-push-token> --platform <ios|android> --label <device-label> [--server-url <device-server-url>] [--json]`: register or refresh a mobile device.
- `bb push-notifications remove <id> [--json]`: remove a mobile device.
- `bb push-notifications status [--json]`: channel switches, mobile relay, subscription count, and last mobile send result.
- `bb push-notifications enqueue --plugin <id> --event <event-id> [--json]`: queue a durable plugin event for delivery using the same settings.
- `bb push-notifications test <web|desktop> [--json]`: broadcast a test to connected clients of that type. Fails if the channel is disabled.
- `bb plugin config push-notifications set <mobileEnabled|webEnabled|desktopEnabled> <true|false>`: change a channel.

Every command takes `--help`. A failure with `--json` prints `{ "ok": false, "error": { "code", "message" } }` on stdout and the readable text on stderr.

Agents can use the SDK’s plugin settings API for the same switches and `sdk.plugins.callRpc({ pluginId: "push-notifications", method: "notifications.test", input: { channel: "web" }, outputSchema: z.object({ ok: z.literal(true) }) })` to send a test. RPC input is validated by `pushNotificationsRpcContract`. Permission requests still require a click in the target client.

## Plugin notification sources

A plugin can expose `notifications.resolve({ eventId })` and call `sdk.plugins.callRpc({ pluginId: "push-notifications", method: "notifications.enqueue", input: { pluginId: "bots", eventId }, outputSchema: z.object({ ok: z.literal(true) }) })` after persisting a visible event. The enqueue operation is idempotent for 24 hours and survives plugin reloads. Unavailable sources retry every 30 seconds; events expire after 24 hours. As with thread pushes, a failed relay request is recorded without repeating a notification already delivered to other devices.

At delivery, the source returns `null` to suppress a read, deleted, archived, or superseded event, or `{ title, body, kind, threadId, projectId, path?, coalesceKey? }`. `kind` is `turn-finished`, `thread-error`, or `pending-interaction`. `threadId` may be null when a plugin path exists. A path must stay inside `/plugins/<source-plugin-id>/<panel>/…`; external URLs and traversal are rejected. Keep a backing thread ID when available for mobile compatibility and server-profile discovery. Current mobile clients use the plugin path; older clients fall back to the thread. Browser and desktop plugin links reload the app at that local path. Questions and approvals should omit the path to open the thread's input controls.

Keep source events durable until they expire, and recheck current read/archive/membership state in the resolver. Pending interaction content uses the same question/approval preview as thread notifications. Bots stores an outbox with each public reply, terminal failure, or pending interaction. Owner messages, system notices, silent PASS replies, cancelled work, and events already read in the channel do not notify.

Set `coalesceKey` to a stable destination ID (Bots uses the channel ID) to combine simultaneous events. Pending input takes priority over errors and replies. Device registration stores the profile’s server URL so taps can find the right server even when a channel error has no backing thread; older servers accept the mobile client’s legacy registration fallback.
