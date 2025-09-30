export const EVENTS = {
  HELLO: "hello",

  // queue lifecycle (YOUR names)
  QUEUE_BOOTSTRAP: "queue:bootstrap",
  QUEUE_NEW: "queue:new",
  QUEUE_REMOVE: "queue:remove",

  // accept & close
  AGENT_CLAIM: "agent:claim",
  SESSION_CLOSE: "session:close",

  // end flow
  END_REQUESTED: "session:end:requested",
  END_ACCEPT: "session:end:accept",
  END_DECLINE: "session:end:decline",

  // messages
  MESSAGE_HISTORY: "message:history",
  MESSAGE_NEW: "message:new",
  MESSAGE_SEND: "message:send",

  // session status
  SESSION_CLOSED: "session:closed",
};
