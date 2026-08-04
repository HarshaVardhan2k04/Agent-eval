// Joi validation middleware — house style: one validateRequest factory + a schemas registry.
const Joi = require('joi');

const validateRequest = (schema) => (req, res, next) => {
  const { error } = schema.validate(req.body, { abortEarly: false });
  if (error) {
    return res.status(400).json({
      error: 'Validation failed',
      details: error.details.map((d) => ({ field: d.path.join('.'), message: d.message })),
    });
  }
  next();
};

// One create/update pair per resource. Filled in as each module lands.
const schemas = {
  // --- Prompt Eval ---
  createEval: Joi.object({
    name: Joi.string().max(255).optional().allow(null, ''),
    system_prompt: Joi.string().min(1).required(),
    scenarios: Joi.alternatives(Joi.object(), Joi.array()).required(),
    config: Joi.object().required(),
  }),
  rerunEval: Joi.object({
    version: Joi.number().integer().min(0).required(),
  }),

  // --- Test STT ---
  createSttBatch: Joi.object({
    name: Joi.string().max(255).optional().allow(null, ''),
    language: Joi.string().max(16).optional(),
    provider: Joi.string().max(64).optional().allow(null, ''),
    mode: Joi.string().valid('single', 'batch', 'import', 'noise').optional(),
    vertical: Joi.string().max(64).optional().allow(null, ''),
  }),
  importSttCalls: Joi.object({
    vertical: Joi.string().min(1).required(),
    call_ids: Joi.array().items(Joi.string()).min(1).required(),
  }),

  // --- Call Analysis ---
  createCallBatch: Joi.object({
    name: Joi.string().max(255).optional().allow(null, ''),
    // Free-form label (inbound/outbound/follow_up/anything) — flows aren't a fixed shape.
    direction: Joi.string().max(64).optional().allow(null, ''),
    flow_id: Joi.string().optional().allow(null, ''),   // judge against a saved Flow
    editable_config: Joi.alternatives(Joi.object(), Joi.string()).optional(),
    tools: Joi.array().items(Joi.string()).optional(),
  }),
  addCalls: Joi.object({
    calls: Joi.array().items(
      Joi.object({
        call_id: Joi.string().optional().allow(null, ''),
        transcript: Joi.string().min(1).required(),
        direction: Joi.string().optional().allow(null, ''),
        editable_config: Joi.alternatives(Joi.object(), Joi.string()).optional(),
        available_tools: Joi.array().items(Joi.string()).optional(),
        tool_events: Joi.array().optional(),
      }).unknown(true)
    ).min(1).required(),
  }),

  // --- Flow Builder ---
  generateFlow: Joi.object({
    text: Joi.string().min(1).required(),
    notes: Joi.string().allow('').optional(),
    direction: Joi.string().optional(),
  }),
  editFlow: Joi.object({
    graph: Joi.object({
      nodes: Joi.array().required(),
      edges: Joi.array().required(),
    }).unknown(true).required(),
    instruction: Joi.string().min(1).required(),
  }),
  saveFlow: Joi.object({
    name: Joi.string().min(1).max(255).required(),
    direction: Joi.string().optional(),
    definition: Joi.object({
      nodes: Joi.array().required(),
      edges: Joi.array().required(),
    }).unknown(true).required(),
  }),
  updateFlow: Joi.object({
    name: Joi.string().min(1).max(255).optional(),
    direction: Joi.string().optional(),
    definition: Joi.object().unknown(true).optional(),
  }),

  // --- Settings / Test-an-LLM ---
  setSetting: Joi.object({
    value: Joi.any().required(),
  }),
  // --- RAG Testing ---
  ragEvaluate: Joi.object({
    name: Joi.string().max(255).optional().allow(null, ''),
    rag_url: Joi.string().uri().optional().allow(null, ''),
    collection: Joi.string().min(1).required(),
    query: Joi.string().min(1).required(),
    gold_answer: Joi.string().optional().allow(null, ''),
    search_type: Joi.string().valid('hybrid', 'keyword', 'text').optional(),
    top_k: Joi.number().integer().min(1).max(20).optional(),
    alpha: Joi.number().min(0).max(1).optional(),
    rerank: Joi.boolean().optional(),
    distance_threshold: Joi.number().min(0).max(2).optional().allow(null),
    answer_mode: Joi.string().valid('generate', 'provided', 'none').optional(),
    answer: Joi.string().optional().allow(null, ''),
  }),

  llmTest: Joi.object({
    base_url: Joi.string().allow('', null).optional(),
    model: Joi.string().allow('', null).optional(),
    system: Joi.string().allow('', null).optional(),
    prompt: Joi.string().min(1).required(),
    enable_thinking: Joi.boolean().optional(),
    temperature: Joi.number().min(0).max(2).optional(),
    max_tokens: Joi.number().integer().min(1).max(8000).optional(),
  }),
};

module.exports = { validateRequest, schemas };
