// packages/server/src/kafka.ts
import { Kafka, logLevel, Producer } from 'kafkajs';
import crypto from 'node:crypto';

let producer: Producer | null = null;
let disabled = false;
let connectedOnce = false;

function isEnabled() {
  // default OFF if brokers are missing
  if (disabled) return false;
  const envToggle = (process.env.KAFKA_ENABLED ?? 'true').toLowerCase();
  if (envToggle === 'false' || envToggle === '0' || envToggle === 'no') return false;
  const brokers = process.env.KAFKA_BROKERS || '';
  return brokers.trim().length > 0;
}

export async function initKafka() {
  if (!isEnabled()) {
    disabled = true;
    return false;
  }
  if (connectedOnce && producer) return true;
  try {
    const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
    const kafka = new Kafka({
      clientId: process.env.KAFKA_CLIENT_ID || 'webchat',
      brokers,
      logLevel: logLevel.NOTHING,
    });
    producer = kafka.producer({ allowAutoTopicCreation: true, idempotent: true });
    await producer.connect();
    connectedOnce = true;
    return true;
  } catch (err) {
    // disable quietly; chat must continue
    disabled = true;
    console.warn('[kafka] disabled (connect failed):', (err as any)?.message || err);
    return false;
  }
}

export async function publishSafe(topic: string, key: string, payload: any) {
  if (disabled || !isEnabled()) return;
  try {
    if (!producer) {
      const ok = await initKafka();
      if (!ok) return;
    }
    await producer!.send({
      topic,
      messages: [{ key, value: JSON.stringify(payload) }],
      acks: -1,
    });
  } catch (err) {
    // don’t throw into request path
    console.warn('[kafka] publish skipped:', (err as any)?.message || err);
    disabled = true; // avoid spamming errors; can re-enable by restarting
  }
}

export function envelope(eventType: string, sessionId: string, data: any) {
  return {
    eventId: crypto.randomUUID(),
    eventType,
    occurredAt: new Date().toISOString(),
    sessionId,
    data,
  };
}
