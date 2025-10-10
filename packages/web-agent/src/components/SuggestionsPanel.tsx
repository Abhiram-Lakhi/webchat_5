import React from "react";

export function SuggestionsPanel({ items, onSend }: { items: string[]; onSend: (text: string) => void }) {
  if (!items?.length) return null;
  return (
    <aside className="p-3 border-l w-80 overflow-y-auto">
      <div className="font-semibold mb-2">Suggestions</div>
      <ul className="space-y-2">
        {items.map((s, i) => (
          <li key={i} className="p-2 rounded border">
            <div className="text-sm whitespace-pre-wrap">{s}</div>
            <div className="mt-2 flex gap-2">
              <button className="px-2 py-1 text-xs border rounded" onClick={() => onSend(s)}>Send</button>
              {/* If you support editing before send, open your compose box prefilled with s */}
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
