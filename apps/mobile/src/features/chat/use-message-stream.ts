import type { Message } from '@karen/api-contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useServices } from '../../auth/services';
import { chatKeys, upsertMessages, useChatActions } from '../../lib/chat-queries';
import {
  applyChatEvent,
  liveFromMessage,
  mergeSnapshot,
  type LiveMessage,
} from '../../lib/chat-state';
import { ChatStreamFollower, type StreamConnection } from '../../lib/chat-stream';

/**
 * Follows the stream of one in-progress assistant message. Pauses when the app goes to the
 * background and resumes from the last event seq on return (no duplicated text). When the
 * answer finishes, the cached conversation is refreshed from the server (authoritative).
 */
export function useMessageStream(conversationId: string, message: Message | null) {
  const { session, baseUrl, streamFetch } = useServices();
  const actions = useChatActions();
  const client = useQueryClient();
  const [live, setLive] = useState<LiveMessage | null>(null);
  const [connection, setConnection] = useState<StreamConnection>('closed');
  const [fatal, setFatal] = useState<string | null>(null);
  const getMessage = useRef(actions.getMessage);
  getMessage.current = actions.getMessage;
  const messageId = message?.id ?? null;
  const done = message
    ? ['completed', 'incomplete', 'failed', 'canceled'].includes(message.status)
    : true;

  useEffect(() => {
    if (!message || done) {
      setLive(null);
      return;
    }
    setFatal(null);
    setLive(liveFromMessage(message));
    const follower = new ChatStreamFollower(
      {
        baseUrl,
        fetch: streamFetch,
        getAccessToken: () => session.getAccessToken(),
        handleUnauthorized: (used) => session.handleUnauthorized(used),
        pollMessage: () => getMessage.current(conversationId, message.id),
      },
      `/v1/conversations/${conversationId}/messages/${message.id}/stream`,
      // The server stores content and last_event_seq atomically, so resuming after the cached
      // seq continues exactly where the cached text ends.
      message.last_event_seq,
      {
        onEvent: (event) =>
          setLive((cur) => {
            const next = applyChatEvent(cur ?? liveFromMessage(message), event);
            if (next.done && !cur?.done) {
              void client.invalidateQueries({ queryKey: chatKeys.messages(conversationId) });
              void client.invalidateQueries({ queryKey: chatKeys.usage });
            }
            return next;
          }),
        onSnapshot: (m) => {
          setLive((cur) => mergeSnapshot(cur ?? liveFromMessage(m), m));
          if (['completed', 'incomplete', 'failed', 'canceled'].includes(m.status)) {
            upsertMessages(client, conversationId, [m]);
          }
        },
        onConnection: setConnection,
        onFatal: (err) => setFatal(err.message),
      },
    );
    follower.start();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') follower.resume();
      else if (state === 'background') follower.pause();
    });
    return () => {
      sub.remove();
      follower.close();
    };
    // Re-subscribe only when the followed message changes, not on every cache update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, messageId, done]);

  return { live, connection, fatal };
}
