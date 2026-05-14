export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'LunaPerception API',
    version: '0.3.0',
  },
  paths: {
    '/health': {
      get: {
        operationId: 'getHealth',
        tags: ['system'],
        responses: {
          '200': {
            description: 'API health status.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HealthResponse' },
              },
            },
          },
        },
      },
    },
    '/openapi.json': {
      get: {
        operationId: 'getOpenApiDocument',
        tags: ['system'],
        responses: {
          '200': {
            description: 'OpenAPI document.',
          },
        },
      },
    },
    '/research-runs': {
      get: {
        operationId: 'listResearchRuns',
        tags: ['research-runs'],
        parameters: [
          {
            name: 'symbol',
            in: 'query',
            required: false,
            schema: { type: 'string' },
          },
          {
            name: 'status',
            in: 'query',
            required: false,
            schema: { type: 'string' },
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
          },
        ],
        responses: {
          '200': {
            description: 'Research runs for the active workspace.',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/ResearchRunResponse' },
                },
              },
            },
          },
        },
      },
      post: {
        operationId: 'createResearchRun',
        tags: ['research-runs'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateResearchRunRequest' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Research run queued.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ResearchRunQueuedResponse',
                },
              },
            },
          },
        },
      },
    },
    '/research-runs/{id}/workspace': {
      get: {
        operationId: 'getResearchRunWorkspace',
        tags: ['research-runs'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Composite research workspace payload.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/JournalRunWorkspaceResponse',
                },
              },
            },
          },
        },
      },
    },
    '/journal/runs/{id}/workspace': {
      get: {
        operationId: 'getJournalRunWorkspace',
        tags: ['journal'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Composite journal workspace payload.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/JournalRunWorkspaceResponse',
                },
              },
            },
          },
        },
      },
    },
    '/jobs/{id}': {
      get: {
        operationId: 'getJobStatus',
        tags: ['jobs'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Workspace-scoped job status.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/JobStatusResponse' },
              },
            },
          },
        },
      },
    },
    '/jobs/{id}/cancel': {
      post: {
        operationId: 'cancelJob',
        tags: ['jobs'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '201': {
            description: 'Cancelled or cancellation-requested job status.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/JobStatusResponse' },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      JsonRecord: {
        type: 'object',
        additionalProperties: true,
      },
      HealthResponse: {
        type: 'object',
        required: ['status', 'service', 'uptime_seconds'],
        properties: {
          status: { type: 'string', enum: ['ok'] },
          service: { type: 'string', enum: ['api'] },
          uptime_seconds: { type: 'number' },
        },
      },
      EngineRunRequest: {
        type: 'object',
        required: [
          'run_id',
          'workspace_id',
          'symbol',
          'asset_class',
          'market_type',
          'analysis_date',
          'analysts',
          'config_profile',
          'dry_run',
          'metadata',
        ],
        properties: {
          run_id: { type: 'string' },
          workspace_id: { type: 'string', minLength: 1 },
          symbol: { type: 'string', minLength: 1 },
          asset_class: { type: 'string', default: 'crypto' },
          market_type: { type: 'string', enum: ['spot', 'perp'], default: 'spot' },
          analysis_date: { type: 'string', format: 'date' },
          analysts: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'string',
              enum: ['market', 'news', 'social', 'onchain'],
            },
          },
          config_profile: { type: 'string', default: 'default' },
          exchange: { type: ['string', 'null'] },
          dry_run: { type: 'boolean', default: false },
          metadata: { $ref: '#/components/schemas/JsonRecord' },
        },
      },
      CreateResearchRunRequest: {
        type: 'object',
        required: ['workspace_id', 'symbol', 'analysis_date', 'analysts'],
        properties: {
          run_id: { type: 'string' },
          workspace_id: { type: 'string', minLength: 1 },
          symbol: { type: 'string', minLength: 1 },
          asset_class: { type: 'string', default: 'crypto' },
          market_type: { type: 'string', enum: ['spot', 'perp'], default: 'spot' },
          analysis_date: { type: 'string', format: 'date' },
          analysts: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'string',
              enum: ['market', 'news', 'social', 'onchain'],
            },
          },
          config_profile: { type: 'string', default: 'default' },
          exchange: { type: ['string', 'null'] },
          dry_run: { type: 'boolean', default: false },
          metadata: { $ref: '#/components/schemas/JsonRecord' },
        },
      },
      WorkspacePermissionDto: {
        type: 'object',
        required: ['user_id', 'workspace_id', 'role'],
        properties: {
          user_id: { type: 'string' },
          workspace_id: { type: 'string' },
          role: { type: 'string' },
        },
      },
      ResearchRunQueuedResponse: {
        type: 'object',
        required: ['run_id', 'workspace_id', 'status', 'job_id', 'queue_backend', 'permission'],
        properties: {
          run_id: { type: 'string' },
          workspace_id: { type: 'string' },
          status: { type: 'string' },
          job_id: { type: 'string' },
          queue_backend: { type: 'string', enum: ['bullmq', 'memory', 'inline'] },
          permission: { $ref: '#/components/schemas/WorkspacePermissionDto' },
          result: { $ref: '#/components/schemas/JsonRecord' },
        },
      },
      JobStatusResponse: {
        type: 'object',
        required: [
          'id',
          'run_id',
          'workspace_id',
          'backend',
          'status',
          'created_at',
          'started_at',
          'completed_at',
          'error_code',
          'error_message',
          'retry_count',
          'attempts',
          'max_attempts',
          'progress',
          'heartbeat_at',
          'cancellation_requested_at',
          'timeout_at',
        ],
        properties: {
          id: { type: 'string' },
          run_id: { type: 'string' },
          workspace_id: { type: 'string' },
          backend: { type: 'string', enum: ['bullmq', 'memory', 'inline'] },
          status: { type: 'string' },
          created_at: { type: 'string' },
          started_at: { type: ['string', 'null'] },
          completed_at: { type: ['string', 'null'] },
          error_code: { type: ['string', 'null'] },
          error_message: { type: ['string', 'null'] },
          retry_count: { type: 'integer' },
          attempts: { type: 'integer' },
          max_attempts: { type: 'integer' },
          progress: { $ref: '#/components/schemas/JsonRecord' },
          heartbeat_at: { type: ['string', 'null'] },
          cancellation_requested_at: { type: ['string', 'null'] },
          timeout_at: { type: ['string', 'null'] },
          result_summary: { $ref: '#/components/schemas/JsonRecord' },
          result: { $ref: '#/components/schemas/JsonRecord' },
        },
      },
      ResearchRunResponse: {
        type: 'object',
        required: [
          'id',
          'run_id',
          'workspace_id',
          'symbol',
          'asset_class',
          'market_type',
          'timeframe',
          'status',
          'started_at',
          'completed_at',
          'thesis_id',
          'decision_id',
          'signal_snapshot_id',
          'market_snapshot_id',
          'degradation_reasons',
          'missing_core_data',
          'missing_optional_data',
        ],
        properties: {
          id: { type: ['string', 'null'] },
          run_id: { type: ['string', 'null'] },
          workspace_id: { type: 'string' },
          symbol: { type: 'string' },
          asset_class: { type: 'string' },
          market_type: { type: 'string' },
          timeframe: { type: ['string', 'null'] },
          status: { type: 'string' },
          started_at: { type: ['string', 'null'] },
          completed_at: { type: ['string', 'null'] },
          thesis_id: { type: ['string', 'null'] },
          decision_id: { type: ['string', 'null'] },
          signal_snapshot_id: { type: ['string', 'null'] },
          market_snapshot_id: { type: ['string', 'null'] },
          degradation_reasons: { type: 'array', items: { type: 'string' } },
          missing_core_data: { type: 'array', items: { type: 'string' } },
          missing_optional_data: { type: 'array', items: { type: 'string' } },
        },
      },
      ResearchRunEventResponse: {
        type: 'object',
        required: ['id', 'workspace_id', 'research_run_id', 'thesis_id', 'event_type', 'created_at', 'message', 'payload'],
        properties: {
          id: { type: ['string', 'null'] },
          workspace_id: { type: 'string' },
          research_run_id: { type: ['string', 'null'] },
          thesis_id: { type: ['string', 'null'] },
          event_type: { type: 'string' },
          created_at: { type: ['string', 'null'] },
          message: { type: 'string' },
          payload: { $ref: '#/components/schemas/JsonRecord' },
        },
      },
      MarketSnapshotResponse: {
        type: 'object',
        required: ['id', 'workspace_id', 'research_run_id', 'symbol', 'captured_at', 'current_price', 'source', 'source_timestamp', 'payload'],
        properties: {
          id: { type: ['string', 'null'] },
          workspace_id: { type: 'string' },
          research_run_id: { type: ['string', 'null'] },
          symbol: { type: 'string' },
          captured_at: { type: ['string', 'null'] },
          current_price: { type: ['number', 'null'] },
          source: { type: 'string' },
          source_timestamp: { type: ['string', 'null'] },
          payload: { $ref: '#/components/schemas/JsonRecord' },
        },
      },
      SignalSnapshotResponse: {
        type: 'object',
        required: ['id', 'workspace_id', 'research_run_id', 'symbol', 'captured_at', 'composite_signal_id', 'signal_count', 'bullish_count', 'bearish_count', 'neutral_count', 'stale_count', 'unknown_freshness_count', 'payload'],
        properties: {
          id: { type: ['string', 'null'] },
          workspace_id: { type: 'string' },
          research_run_id: { type: ['string', 'null'] },
          symbol: { type: 'string' },
          captured_at: { type: ['string', 'null'] },
          composite_signal_id: { type: ['string', 'null'] },
          signal_count: { type: ['number', 'null'] },
          bullish_count: { type: ['number', 'null'] },
          bearish_count: { type: ['number', 'null'] },
          neutral_count: { type: ['number', 'null'] },
          stale_count: { type: ['number', 'null'] },
          unknown_freshness_count: { type: ['number', 'null'] },
          payload: { $ref: '#/components/schemas/JsonRecord' },
        },
      },
      ResearchRunSnapshotsResponse: {
        type: 'object',
        required: ['market_snapshot', 'signal_snapshot'],
        properties: {
          market_snapshot: {
            anyOf: [{ $ref: '#/components/schemas/MarketSnapshotResponse' }, { type: 'null' }],
          },
          signal_snapshot: {
            anyOf: [{ $ref: '#/components/schemas/SignalSnapshotResponse' }, { type: 'null' }],
          },
        },
      },
      ResearchRunArtifactResponse: {
        type: 'object',
        required: ['kind', 'label', 'path', 'exists', 'size_bytes', 'modified_at'],
        properties: {
          kind: { type: 'string', enum: ['full_report', 'full_state'] },
          label: { type: 'string' },
          path: { type: ['string', 'null'] },
          exists: { type: 'boolean' },
          size_bytes: { type: ['number', 'null'] },
          modified_at: { type: ['string', 'null'] },
        },
      },
      ResearchRunArtifactsResponse: {
        type: 'object',
        required: ['full_report', 'full_state'],
        properties: {
          full_report: { $ref: '#/components/schemas/ResearchRunArtifactResponse' },
          full_state: { $ref: '#/components/schemas/ResearchRunArtifactResponse' },
        },
      },
      DebateResponse: {
        type: 'object',
        required: ['id', 'workspace_id', 'research_run_id', 'symbol', 'consensus_stance', 'conflict_level', 'created_at', 'payload'],
        properties: {
          id: { type: ['string', 'null'] },
          workspace_id: { type: 'string' },
          research_run_id: { type: ['string', 'null'] },
          symbol: { type: 'string' },
          consensus_stance: { type: 'string' },
          conflict_level: { type: 'string' },
          created_at: { type: ['string', 'null'] },
          payload: { $ref: '#/components/schemas/JsonRecord' },
        },
      },
      AgentOpinionResponse: {
        type: 'object',
        required: ['id', 'workspace_id', 'debate_id', 'research_run_id', 'agent_name', 'agent_role', 'stance', 'confidence', 'created_at', 'payload'],
        properties: {
          id: { type: ['string', 'null'] },
          workspace_id: { type: 'string' },
          debate_id: { type: ['string', 'null'] },
          research_run_id: { type: ['string', 'null'] },
          agent_name: { type: 'string' },
          agent_role: { type: 'string' },
          stance: { type: 'string' },
          confidence: { type: ['number', 'null'] },
          created_at: { type: ['string', 'null'] },
          payload: { $ref: '#/components/schemas/JsonRecord' },
        },
      },
      ResearchRunDebateResponse: {
        type: 'object',
        required: ['debate', 'agent_opinions'],
        properties: {
          debate: {
            anyOf: [{ $ref: '#/components/schemas/DebateResponse' }, { type: 'null' }],
          },
          agent_opinions: {
            type: 'array',
            items: { $ref: '#/components/schemas/AgentOpinionResponse' },
          },
        },
      },
      ThesisSummaryResponse: {
        type: 'object',
        required: [
          'rating',
          'direction',
          'confidence',
          'market_type',
          'action_summary',
          'entry_zone',
          'upside_catalyst',
          'invalidation',
          'target_zones',
          'key_reasons',
          'risks',
          'spot_notes',
          'perp_notes',
          'missing_data',
          'is_degraded',
          'degradation_reasons',
        ],
        properties: {
          rating: { type: 'string' },
          direction: { type: 'string' },
          confidence: { type: ['number', 'null'] },
          market_type: { type: 'string' },
          action_summary: { type: 'string' },
          entry_zone: { type: 'string' },
          upside_catalyst: { type: 'string' },
          invalidation: { type: 'string' },
          target_zones: { type: 'array', items: { type: 'string' } },
          key_reasons: { type: 'array', items: { type: 'string' } },
          risks: { type: 'array', items: { type: 'string' } },
          spot_notes: { type: 'string' },
          perp_notes: { type: 'string' },
          missing_data: { type: 'array', items: { type: 'string' } },
          is_degraded: { type: 'boolean' },
          degradation_reasons: { type: 'array', items: { type: 'string' } },
        },
      },
      ThesisResponse: {
        type: 'object',
        required: [
          'id',
          'workspace_id',
          'research_run_id',
          'symbol',
          'direction',
          'setup_type',
          'confidence',
          'confidence_source',
          'confidence_rationale',
          'quant_confidence',
          'quant_bias',
          'stability_guard',
          'created_at',
          'entry_zone',
          'invalidation_level',
          'target_zones',
          'thesis_text',
          'summary',
          'supporting_signal_ids',
          'contradicting_signal_ids',
          'stale_or_missing_data',
          'monitor_next',
        ],
        properties: {
          id: { type: ['string', 'null'] },
          workspace_id: { type: 'string' },
          research_run_id: { type: ['string', 'null'] },
          symbol: { type: 'string' },
          direction: { type: 'string' },
          setup_type: { type: 'string' },
          confidence: { type: ['number', 'null'] },
          confidence_source: { type: 'string' },
          confidence_rationale: { type: 'string' },
          quant_confidence: { type: ['number', 'null'] },
          quant_bias: { type: 'string' },
          stability_guard: { $ref: '#/components/schemas/JsonRecord' },
          created_at: { type: ['string', 'null'] },
          entry_zone: { type: 'string' },
          invalidation_level: { type: 'string' },
          target_zones: { type: 'array', items: { type: 'string' } },
          thesis_text: { type: 'string' },
          summary: { $ref: '#/components/schemas/ThesisSummaryResponse' },
          supporting_signal_ids: { type: 'array', items: { type: 'string' } },
          contradicting_signal_ids: { type: 'array', items: { type: 'string' } },
          stale_or_missing_data: { type: 'array', items: { type: 'string' } },
          monitor_next: { type: 'array', items: { type: 'string' } },
        },
      },
      ScenarioResponse: {
        type: 'object',
        required: [
          'id',
          'workspace_id',
          'thesis_id',
          'probability_band',
          'suggested_user_action',
          'condition',
          'expected_behavior',
          'payload',
        ],
        properties: {
          id: { type: ['string', 'null'] },
          workspace_id: { type: 'string' },
          thesis_id: { type: 'string' },
          probability_band: { type: 'string' },
          suggested_user_action: { type: 'string' },
          condition: { type: 'string' },
          expected_behavior: { type: 'string' },
          payload: { $ref: '#/components/schemas/JsonRecord' },
        },
      },
      JournalRunWorkspaceResponse: {
        type: 'object',
        required: [
          'run',
          'events',
          'snapshots',
          'debate',
          'thesis',
          'scenarios',
          'artifacts',
        ],
        properties: {
          run: { $ref: '#/components/schemas/ResearchRunResponse' },
          events: {
            type: 'array',
            items: { $ref: '#/components/schemas/ResearchRunEventResponse' },
          },
          snapshots: { $ref: '#/components/schemas/ResearchRunSnapshotsResponse' },
          debate: { $ref: '#/components/schemas/ResearchRunDebateResponse' },
          thesis: {
            anyOf: [{ $ref: '#/components/schemas/ThesisResponse' }, { type: 'null' }],
          },
          scenarios: {
            type: 'array',
            items: { $ref: '#/components/schemas/ScenarioResponse' },
          },
          artifacts: { $ref: '#/components/schemas/ResearchRunArtifactsResponse' },
        },
      },
    },
  },
} as const;
