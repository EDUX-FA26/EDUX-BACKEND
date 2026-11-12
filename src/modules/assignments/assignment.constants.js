const DEFAULT_RUBRIC_CONFIGS = [
  {
    criterion_key: 'PROBLEM_ABSTRACTION',
    criterion_name: 'Problem Abstraction & Solution Design',
    is_enabled: true,
    weight_percent: 20,
    display_order: 1,
  },
  {
    criterion_key: 'IMPLEMENTATION_QUALITY',
    criterion_name: 'Implementation & Code Quality',
    is_enabled: true,
    weight_percent: 30,
    display_order: 2,
  },
  {
    criterion_key: 'CRITICAL_EVALUATION',
    criterion_name: 'Critical Evaluation & Verification',
    is_enabled: true,
    weight_percent: 25,
    display_order: 3,
  },
  {
    criterion_key: 'AI_INTERACTION',
    criterion_name: 'AI Interaction & Prompt Engineering',
    is_enabled: true,
    weight_percent: 15,
    display_order: 4,
  },
  {
    criterion_key: 'METACOGNITIVE_REFLECTION',
    criterion_name: 'Metacognitive Reflection & Transparency',
    is_enabled: true,
    weight_percent: 10,
    display_order: 5,
  },
];

module.exports = {
  DEFAULT_RUBRIC_CONFIGS,
};

