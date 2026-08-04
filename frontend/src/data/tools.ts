// The fixed agent toolset (from engage-voice-agents). Grouped for the tools
// checklist in Call Analysis intake and Settings. "core" = on by default.
export type ToolDef = { name: string; desc: string; core?: boolean }
export type ToolGroup = { group: string; tools: ToolDef[] }

export const TOOL_GROUPS: ToolGroup[] = [
  {
    group: 'Call handling',
    tools: [
      { name: 'end_call', desc: 'Hang up the call', core: true },
      { name: 'voicemail_detected', desc: 'Detected voicemail — end silently', core: true },
      { name: 'handle_call_screening', desc: 'Handle a screening gatekeeper', core: true },
      { name: 'irrelevant_interruption', desc: 'Ignore an off-topic interruption', core: true },
      { name: 'switch_tts_provider', desc: 'Change the voice/TTS provider' },
      { name: 'date_calculator', desc: 'Resolve relative dates ("next Tuesday")', core: true },
      { name: 'send_whatsapp_template', desc: 'Send a WhatsApp template message', core: true },
    ],
  },
  {
    group: 'Knowledge / lookup',
    tools: [
      { name: 'search_knowledge_base', desc: 'Look something up in the KB', core: true },
      { name: 'web_search', desc: 'Search the web' },
      { name: 'get_location_details', desc: 'Resolve a location / service center', core: true },
    ],
  },
  {
    group: 'Escalation',
    tools: [
      { name: 'warm_transfer_call', desc: 'Escalate to a human supervisor (warm: hold, brief, connect)', core: true },
      { name: 'switch_agent', desc: 'Hand off to a different AI agent' },
    ],
  },
  {
    group: 'Supervisor-internal (off by default)',
    tools: [
      { name: 'connect_to_caller', desc: 'Supervisor: connect to the caller' },
      { name: 'decline_transfer', desc: 'Supervisor: decline a transfer' },
      { name: 'supervisor_voicemail_detected', desc: 'Supervisor: voicemail detected' },
    ],
  },
]

export const CORE_TOOLS = TOOL_GROUPS.flatMap((g) => g.tools).filter((t) => t.core).map((t) => t.name)
export const ALL_TOOLS = TOOL_GROUPS.flatMap((g) => g.tools).map((t) => t.name)
