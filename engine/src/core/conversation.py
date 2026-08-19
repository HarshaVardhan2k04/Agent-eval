import re

from src.config import DEFAULT_AGENT_TEMPERATURE, DEFAULT_USER_TEMPERATURE, DEFAULT_MAX_TOKENS
from src.llm.prompts import USER_PERSONA_WRAPPER

_THINK_TAG_RE = re.compile(r"<\s*think\s*>.*?</\s*think\s*>", re.DOTALL | re.IGNORECASE)
_STRAY_TAG_RE = re.compile(r"<\s*/?\s*(?:think|thought|response)\s*>", re.IGNORECASE)


def _strip_thinking(text):
    text = _THINK_TAG_RE.sub("", text)
    text = _STRAY_TAG_RE.sub("", text)
    return text.strip()


class ConversationEngine:
    def __init__(self, llm_client, tool_simulator=None, rag_client=None, user_llm=None):
        self.llm = llm_client                 # the AGENT under test
        self.user_llm = user_llm or llm_client  # the simulated customer (fixed for fair arena scoring)
        self.tool_simulator = tool_simulator
        self.rag_client = rag_client

    async def _llm_call(self, messages, temperature=None, tools=None, as_user=False):
        temp = temperature if temperature is not None else DEFAULT_AGENT_TEMPERATURE
        client = self.user_llm if as_user else self.llm
        msg = await client.chat(messages, tools=tools, temperature=temp, max_tokens=DEFAULT_MAX_TOKENS)
        return msg

    def _fresh_tools(self):
        # New conversation → fresh per-call tool state (mirrors production's fresh
        # session userdata), then the schema list for the tools param.
        if not self.tool_simulator:
            return None
        self.tool_simulator.reset_conversation()
        return self.tool_simulator.get_schemas()

    async def _handle_tool_calls(self, response, messages, tools_schema):
        tool_calls_made = []
        while response.tool_calls:
            for tc in response.tool_calls:
                tool_result = await self.tool_simulator.execute(
                    tc.function.name, tc.function.arguments
                )
                tool_calls_made.append({
                    "name": tc.function.name,
                    "args": tc.function.arguments,
                    "result": tool_result,
                })
                messages.append({
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {
                                "name": tc.function.name,
                                "arguments": tc.function.arguments,
                            },
                        }
                    ],
                })
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": str(tool_result),
                })
            response = await self._llm_call(messages, tools=tools_schema)
        return response, tool_calls_made

    async def _inject_rag(self, messages, query):
        if not self.rag_client:
            return
        results = await self.rag_client.search(query)
        if results:
            context = self.rag_client.format_results(results)
            messages.append({"role": "system", "content": context})

    async def run_single_turn(self, system_prompt, scenario):
        messages = [{"role": "system", "content": system_prompt}]

        await self._inject_rag(messages, scenario["question"])

        messages.append({"role": "user", "content": scenario["question"]})

        tools_schema = self._fresh_tools()
        response = await self._llm_call(messages, tools=tools_schema)

        tool_calls_made = []
        if response.tool_calls and self.tool_simulator:
            response, tool_calls_made = await self._handle_tool_calls(
                response, messages, tools_schema
            )

        agent_text = _strip_thinking(response.content or "")

        return {
            "scenario_name": scenario.get("name") or scenario.get("test_id", "unknown"),
            "scenario_type": "single_turn",
            "response": agent_text,
            "tool_calls": tool_calls_made,
            "transcript": [
                {"role": "user", "content": scenario["question"]},
                {"role": "agent", "content": agent_text,
                 "latency_ms": getattr(response, "latency_ms", None),
                 "tokens": getattr(response, "completion_tokens", None)},
            ],
        }

    async def run_multi_turn(self, system_prompt, scenario):
        messages = [{"role": "system", "content": system_prompt}]
        tools_schema = self._fresh_tools()
        turn_results = []
        all_tool_calls = []
        transcript = []

        for turn in scenario["turns"]:
            customer_msg = turn["customer"]

            await self._inject_rag(messages, customer_msg)

            messages.append({"role": "user", "content": customer_msg})
            transcript.append({"role": "user", "content": customer_msg})

            response = await self._llm_call(messages, tools=tools_schema)

            turn_tool_calls = []
            if response.tool_calls and self.tool_simulator:
                response, turn_tool_calls = await self._handle_tool_calls(
                    response, messages, tools_schema
                )

            agent_text = _strip_thinking(response.content or "")
            messages.append({"role": "assistant", "content": agent_text})
            transcript.append({"role": "agent", "content": agent_text,
                               "latency_ms": getattr(response, "latency_ms", None),
                               "tokens": getattr(response, "completion_tokens", None)})
            all_tool_calls.extend(turn_tool_calls)

            turn_results.append({
                "customer_message": customer_msg,
                "agent_response": agent_text,
                "tool_calls": turn_tool_calls,
                "expected_behavior": turn.get("expected_behavior"),
                "expected_tools": turn.get("expected_tools", []),
                "max_response_length": turn.get("max_response_length"),
            })

        return {
            "scenario_name": scenario.get("name") or scenario.get("test_id", "unknown"),
            "scenario_type": "multi_turn",
            "turns": turn_results,
            "tool_calls": all_tool_calls,
            "transcript": transcript,
        }

    async def run_simulated(self, system_prompt, scenario):
        greeting = scenario.get("greeting", "")
        user_persona = scenario.get("user_persona", "")
        call_direction = scenario.get("call_direction", "outbound")
        max_turns = int(scenario.get("max_turns", 12))

        agent_messages = [{"role": "system", "content": system_prompt}]
        user_messages = [
            {"role": "system", "content": USER_PERSONA_WRAPPER.format(persona=user_persona)}
        ]

        transcript = []
        # The self-play agent gets its REAL tools (it can genuinely end_call etc.) —
        # otherwise tool-dependent prompts get judged "promised tools, fired none".
        tools_schema = self._fresh_tools()
        all_tool_calls = []
        call_ended = False

        if call_direction == "outbound":
            # An EMPTY greeting must not become an empty assistant turn — some
            # providers (mistral via Io Net) 400 on empty assistant content + tools.
            if (greeting or "").strip():
                agent_messages.append({"role": "assistant", "content": greeting})
                transcript.append({"role": "agent", "content": greeting})
                user_messages.append({"role": "user", "content": greeting})
            else:
                user_messages.append({"role": "user", "content":
                    "You answered the phone. The agent is about to speak — open naturally (e.g. 'Hello?')."})
        else:
            user_messages.append({
                "role": "user",
                "content": "You are calling them now. The agent just picked up and said: " + greeting,
            })
            user_resp = await self._llm_call(user_messages, temperature=DEFAULT_USER_TEMPERATURE, as_user=True)
            user_text = (user_resp.content or "").replace("[END]", "").strip()
            user_messages.append({"role": "assistant", "content": user_text})
            transcript.append({"role": "user", "content": user_text})

            agent_messages.append({"role": "user", "content": user_text})
            agent_resp = await self._llm_call(agent_messages, tools=tools_schema)
            if agent_resp.tool_calls and self.tool_simulator:
                # Production terminal tools: end_call and voicemail_detected both
                # delete the room; the 4th irrelevant_interruption also hangs up.
                if any(tc.function.name in ("end_call", "voicemail_detected") for tc in agent_resp.tool_calls):
                    call_ended = True
                agent_resp, tc_made = await self._handle_tool_calls(agent_resp, agent_messages, tools_schema)
                all_tool_calls.extend(tc_made)
                if getattr(self.tool_simulator, "_irrelevant_count", 0) >= 4:
                    call_ended = True
            agent_text = _strip_thinking(agent_resp.content or "")
            agent_messages.append({"role": "assistant", "content": agent_text})
            transcript.append({"role": "agent", "content": agent_text,
                               "latency_ms": getattr(agent_resp, "latency_ms", None),
                               "tokens": getattr(agent_resp, "completion_tokens", None)})
            user_messages.append({"role": "user", "content": agent_text})

        for _ in range(max_turns):
            if call_ended:
                break
            user_resp = await self._llm_call(user_messages, temperature=DEFAULT_USER_TEMPERATURE, as_user=True)
            user_text = user_resp.content or ""
            ended = "[END]" in user_text
            user_text = user_text.replace("[END]", "").strip()

            if not user_text:
                break

            transcript.append({"role": "user", "content": user_text})
            user_messages.append({"role": "assistant", "content": user_text})

            if ended:
                break

            agent_messages.append({"role": "user", "content": user_text})
            agent_resp = await self._llm_call(agent_messages, tools=tools_schema)
            if agent_resp.tool_calls and self.tool_simulator:
                # Production terminal tools: end_call and voicemail_detected both
                # delete the room; the 4th irrelevant_interruption also hangs up.
                if any(tc.function.name in ("end_call", "voicemail_detected") for tc in agent_resp.tool_calls):
                    call_ended = True
                agent_resp, tc_made = await self._handle_tool_calls(agent_resp, agent_messages, tools_schema)
                all_tool_calls.extend(tc_made)
                if getattr(self.tool_simulator, "_irrelevant_count", 0) >= 4:
                    call_ended = True
            agent_text = _strip_thinking(agent_resp.content or "")
            agent_messages.append({"role": "assistant", "content": agent_text})
            transcript.append({"role": "agent", "content": agent_text,
                               "latency_ms": getattr(agent_resp, "latency_ms", None),
                               "tokens": getattr(agent_resp, "completion_tokens", None)})
            user_messages.append({"role": "user", "content": agent_text})
            if call_ended:
                break

        return {
            "scenario_name": scenario.get("name") or scenario.get("test_id", "unknown"),
            "scenario_type": "simulated",
            "transcript": transcript,
            "tool_calls": all_tool_calls,
            "expected_outcome": scenario.get("expected_outcome"),
            "pass_criteria": scenario.get("pass_criteria"),
            "fail_criteria": scenario.get("fail_criteria"),
        }
