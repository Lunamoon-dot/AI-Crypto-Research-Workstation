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
    '/research-runs/{id}': {
      get: {
        operationId: 'getResearchRun',
        tags: ['research-runs'],
        parameters: [pathParameter('id')],
        responses: jsonResponse(
          'Workspace-scoped research run.',
          'ResearchRunResponse',
        ),
      },
    },
    '/research-runs/{id}/events': {
      get: {
        operationId: 'listResearchRunEvents',
        tags: ['research-runs'],
        parameters: [pathParameter('id')],
        responses: jsonArrayResponse(
          'Timeline events for a research run.',
          'ResearchRunEventResponse',
        ),
      },
    },
    '/research-runs/{id}/snapshots': {
      get: {
        operationId: 'getResearchRunSnapshots',
        tags: ['research-runs'],
        parameters: [pathParameter('id')],
        responses: jsonResponse(
          'Market and signal snapshots for a research run.',
          'ResearchRunSnapshotsResponse',
        ),
      },
    },
    '/research-runs/{id}/debate': {
      get: {
        operationId: 'getResearchRunDebate',
        tags: ['research-runs'],
        parameters: [pathParameter('id')],
        responses: jsonResponse(
          'Debate and agent opinions for a research run.',
          'ResearchRunDebateResponse',
        ),
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
    '/signals': {
      get: {
        operationId: 'listSignals',
        tags: ['signals'],
        parameters: [
          queryParameter('symbol', { type: 'string' }),
          limitParameter(50, 100),
        ],
        responses: jsonArrayResponse(
          'Signals for the active workspace.',
          'SignalResponse',
        ),
      },
    },
    '/signals/count': {
      get: {
        operationId: 'countSignals',
        tags: ['signals'],
        parameters: [queryParameter('symbol', { type: 'string' })],
        responses: jsonResponse(
          'Signal direction counts for the active workspace.',
          'SignalCountResponse',
        ),
      },
    },
    '/theses': {
      get: {
        operationId: 'listTheses',
        tags: ['theses'],
        parameters: [limitParameter(50, 100)],
        responses: jsonArrayResponse(
          'Trade theses for the active workspace.',
          'ThesisResponse',
        ),
      },
    },
    '/theses/{id}': {
      get: {
        operationId: 'getThesis',
        tags: ['theses'],
        parameters: [pathParameter('id')],
        responses: jsonResponse(
          'Workspace-scoped trade thesis.',
          'ThesisResponse',
        ),
      },
    },
    '/theses/{id}/scenarios': {
      get: {
        operationId: 'getThesisScenarios',
        tags: ['theses'],
        parameters: [pathParameter('id')],
        responses: jsonArrayResponse(
          'Scenarios for a trade thesis.',
          'ScenarioResponse',
        ),
      },
    },
    '/theses/{id}/decision': {
      post: {
        operationId: 'recordThesisDecision',
        tags: ['theses'],
        parameters: [pathParameter('id')],
        requestBody: jsonRequest('RecordThesisDecisionRequest'),
        responses: jsonResponse(
          'Recorded thesis decision.',
          'ThesisDecisionResponse',
          '201',
        ),
      },
    },
    '/theses/{id}/review': {
      post: {
        operationId: 'recordThesisReview',
        tags: ['theses'],
        parameters: [pathParameter('id')],
        requestBody: jsonRequest('RecordThesisReviewRequest'),
        responses: jsonResponse(
          'Recorded thesis outcome review.',
          'ThesisReviewResponse',
          '201',
        ),
      },
    },
    '/watchlists': {
      get: {
        operationId: 'listWatchlists',
        tags: ['watchlists'],
        parameters: [limitParameter(50, 100)],
        responses: jsonArrayResponse(
          'Watchlists for the active workspace.',
          'WatchlistResponse',
        ),
      },
      post: {
        operationId: 'createWatchlist',
        tags: ['watchlists'],
        requestBody: jsonRequest('CreateWatchlistRequest'),
        responses: jsonResponse(
          'Created watchlist.',
          'WatchlistResponse',
          '201',
        ),
      },
    },
    '/watchlists/{id}': {
      get: {
        operationId: 'getWatchlist',
        tags: ['watchlists'],
        parameters: [pathParameter('id')],
        responses: jsonResponse(
          'Workspace-scoped watchlist.',
          'WatchlistResponse',
        ),
      },
      patch: {
        operationId: 'updateWatchlist',
        tags: ['watchlists'],
        parameters: [pathParameter('id')],
        requestBody: jsonRequest('UpdateWatchlistRequest'),
        responses: jsonResponse('Updated watchlist.', 'WatchlistResponse'),
      },
    },
    '/watchlists/{id}/items': {
      get: {
        operationId: 'getWatchlistItems',
        tags: ['watchlists'],
        parameters: [pathParameter('id')],
        responses: jsonArrayResponse(
          'Items in a watchlist.',
          'WatchlistItemResponse',
        ),
      },
      post: {
        operationId: 'addWatchlistItem',
        tags: ['watchlists'],
        parameters: [pathParameter('id')],
        requestBody: jsonRequest('AddWatchlistItemRequest'),
        responses: jsonResponse(
          'Created watchlist item.',
          'WatchlistItemResponse',
          '201',
        ),
      },
    },
    '/watchlists/{id}/items/{itemId}': {
      delete: {
        operationId: 'removeWatchlistItem',
        tags: ['watchlists'],
        parameters: [pathParameter('id'), pathParameter('itemId')],
        responses: jsonResponse(
          'Removed watchlist item.',
          'RemoveWatchlistItemResponse',
        ),
      },
    },
    '/watchlists/{id}/check': {
      post: {
        operationId: 'checkWatchlist',
        tags: ['watchlists'],
        parameters: [pathParameter('id')],
        requestBody: jsonRequest('CheckWatchlistRequest'),
        responses: jsonResponse(
          'Watchlist alert check result.',
          'WatchlistCheckResponse',
          '201',
        ),
      },
    },
    '/briefs/daily': {
      get: {
        operationId: 'listDailyBriefs',
        tags: ['briefs'],
        parameters: [
          queryParameter('date', { type: 'string', format: 'date' }),
          limitParameter(20, 100),
          queryParameter('watchlist_id', { type: 'string' }),
          queryParameter('watchlist_name', { type: 'string' }),
        ],
        responses: jsonArrayResponse(
          'Daily market briefs for the active workspace.',
          'BriefResponse',
        ),
      },
      post: {
        operationId: 'createDailyBrief',
        tags: ['briefs'],
        requestBody: jsonRequest('CreateDailyBriefRequest'),
        responses: jsonResponse(
          'Created daily market brief.',
          'BriefResponse',
          '201',
        ),
      },
    },
    '/alerts': {
      get: {
        operationId: 'listAlerts',
        tags: ['alerts'],
        parameters: [
          queryParameter('symbol', { type: 'string' }),
          queryParameter('thesis_id', { type: 'string' }),
          queryParameter('unread', { type: 'boolean' }),
          limitParameter(50, 200),
        ],
        responses: jsonArrayResponse(
          'Alerts for the active workspace.',
          'AlertResponse',
        ),
      },
    },
    '/alerts/{id}/read': {
      post: {
        operationId: 'markAlertRead',
        tags: ['alerts'],
        parameters: [pathParameter('id')],
        responses: jsonResponse('Marked alert.', 'AlertResponse', '201'),
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
      ThesisDecisionResponse: {
        type: 'object',
        required: ['id', 'workspace_id', 'thesis_id', 'action', 'user_notes', 'decided_at'],
        properties: {
          id: { type: ['string', 'null'] },
          workspace_id: { type: 'string' },
          thesis_id: { type: 'string' },
          action: { type: 'string' },
          user_notes: { type: 'string' },
          decided_at: { type: ['string', 'null'] },
        },
      },
      ThesisReviewResponse: {
        type: 'object',
        required: ['id', 'workspace_id', 'thesis_id', 'result', 'lessons', 'reviewed_at', 'invalidated'],
        properties: {
          id: { type: ['string', 'null'] },
          workspace_id: { type: 'string' },
          thesis_id: { type: 'string' },
          result: { type: 'string' },
          lessons: { type: 'string' },
          reviewed_at: { type: ['string', 'null'] },
          invalidated: { type: 'boolean' },
        },
      },
      RecordThesisDecisionRequest: {
        type: 'object',
        required: ['action'],
        properties: {
          action: { type: 'string', minLength: 1 },
          notes: { type: 'string' },
        },
      },
      RecordThesisReviewRequest: {
        type: 'object',
        required: ['result'],
        properties: {
          result: { type: 'string', minLength: 1 },
          notes: { type: 'string' },
        },
      },
      SignalResponse: {
        type: 'object',
        required: ['id', 'workspace_id', 'symbol', 'signal_type', 'direction', 'confidence', 'observed_at', 'source', 'source_timestamp', 'summary'],
        properties: {
          id: { type: ['string', 'null'] },
          workspace_id: { type: 'string' },
          symbol: { type: 'string' },
          signal_type: { type: 'string' },
          direction: { type: 'string' },
          confidence: { type: ['number', 'null'] },
          observed_at: { type: ['string', 'null'] },
          source: { type: 'string' },
          source_timestamp: { type: ['string', 'null'] },
          summary: { type: 'string' },
        },
      },
      SignalCountResponse: {
        type: 'object',
        required: ['total', 'bullish', 'bearish', 'neutral'],
        properties: {
          total: { type: 'integer' },
          bullish: { type: 'integer' },
          bearish: { type: 'integer' },
          neutral: { type: 'integer' },
        },
      },
      WatchlistResponse: {
        type: 'object',
        required: ['id', 'workspace_id', 'name', 'enabled', 'created_at'],
        properties: {
          id: { type: ['string', 'null'] },
          workspace_id: { type: 'string' },
          name: { type: 'string' },
          enabled: { type: 'boolean' },
          created_at: { type: ['string', 'null'] },
        },
      },
      WatchlistItemResponse: {
        type: 'object',
        required: ['id', 'workspace_id', 'watchlist_id', 'item_type', 'symbol', 'thesis_id', 'setup_type', 'enabled', 'created_at'],
        properties: {
          id: { type: ['string', 'null'] },
          workspace_id: { type: 'string' },
          watchlist_id: { type: 'string' },
          item_type: { type: 'string' },
          symbol: { type: ['string', 'null'] },
          thesis_id: { type: ['string', 'null'] },
          setup_type: { type: ['string', 'null'] },
          enabled: { type: 'boolean' },
          created_at: { type: ['string', 'null'] },
        },
      },
      WatchlistCheckResponse: {
        type: 'object',
        required: ['workspace_id', 'watchlist_id', 'checked_items', 'alerts_created', 'skipped_items'],
        properties: {
          workspace_id: { type: 'string' },
          watchlist_id: { type: 'string' },
          checked_items: { type: 'integer' },
          alerts_created: {
            type: 'array',
            items: { $ref: '#/components/schemas/AlertResponse' },
          },
          skipped_items: { type: 'array', items: { type: 'string' } },
        },
      },
      CreateWatchlistRequest: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1 },
          enabled: { type: 'boolean' },
        },
      },
      UpdateWatchlistRequest: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1 },
          enabled: { type: 'boolean' },
        },
      },
      AddWatchlistItemRequest: {
        type: 'object',
        properties: {
          item_type: { type: 'string' },
          symbol: { type: 'string' },
          thesis_id: { type: 'string' },
          setup_type: { type: 'string' },
        },
      },
      CheckWatchlistRequest: {
        type: 'object',
        properties: {
          prices: {
            type: 'object',
            additionalProperties: { type: 'number' },
          },
        },
      },
      RemoveWatchlistItemResponse: {
        type: 'object',
        required: ['id', 'workspace_id', 'watchlist_id', 'removed'],
        properties: {
          id: { type: 'string' },
          workspace_id: { type: 'string' },
          watchlist_id: { type: 'string' },
          removed: { type: 'boolean' },
        },
      },
      BriefAssetSummaryResponse: {
        type: 'object',
        required: ['symbol', 'current_price', 'market_regime', 'trend_direction', 'volatility_regime', 'source', 'source_timestamp', 'summary', 'change_from_previous'],
        properties: {
          symbol: { type: 'string' },
          current_price: { type: ['number', 'null'] },
          market_regime: { type: 'string' },
          trend_direction: { type: 'string' },
          volatility_regime: { type: 'string' },
          source: { type: ['string', 'null'] },
          source_timestamp: { type: ['string', 'null'] },
          summary: { type: 'string' },
          change_from_previous: { type: ['string', 'null'] },
        },
      },
      BriefThesisUpdateResponse: {
        type: 'object',
        required: ['thesis_id', 'symbol', 'direction', 'setup_type', 'confidence', 'status', 'update', 'invalidation_level', 'recent_alerts'],
        properties: {
          thesis_id: { type: 'string' },
          symbol: { type: 'string' },
          direction: { type: 'string' },
          setup_type: { type: 'string' },
          confidence: { type: ['number', 'null'] },
          status: { type: 'string' },
          update: { type: 'string' },
          invalidation_level: { type: ['string', 'null'] },
          recent_alerts: { type: 'array', items: { type: 'string' } },
        },
      },
      BriefResponse: {
        type: 'object',
        required: ['id', 'workspace_id', 'brief_date', 'watchlist_name', 'title', 'created_at', 'previous_brief_id', 'summary', 'key_points', 'thesis_ids', 'signal_ids', 'asset_summaries', 'thesis_updates', 'watchlist_changes', 'top_setups', 'top_risks', 'memory_notes'],
        properties: {
          id: { type: ['string', 'null'] },
          workspace_id: { type: 'string' },
          brief_date: { type: ['string', 'null'] },
          watchlist_name: { type: ['string', 'null'] },
          title: { type: 'string' },
          created_at: { type: ['string', 'null'] },
          previous_brief_id: { type: ['string', 'null'] },
          summary: { type: 'string' },
          key_points: { type: 'array', items: { type: 'string' } },
          thesis_ids: { type: 'array', items: { type: 'string' } },
          signal_ids: { type: 'array', items: { type: 'string' } },
          asset_summaries: {
            type: 'array',
            items: { $ref: '#/components/schemas/BriefAssetSummaryResponse' },
          },
          thesis_updates: {
            type: 'array',
            items: { $ref: '#/components/schemas/BriefThesisUpdateResponse' },
          },
          watchlist_changes: { type: 'array', items: { type: 'string' } },
          top_setups: { type: 'array', items: { type: 'string' } },
          top_risks: { type: 'array', items: { type: 'string' } },
          memory_notes: { type: 'array', items: { type: 'string' } },
        },
      },
      CreateDailyBriefRequest: {
        type: 'object',
        properties: {
          watchlist_id: { type: 'string' },
          watchlist_name: { type: 'string' },
          date: { type: 'string', format: 'date' },
          alerts_limit: { type: 'integer', minimum: 1 },
          evaluate_snapshots: { type: 'boolean' },
          save: { type: 'boolean' },
        },
      },
      AlertResponse: {
        type: 'object',
        required: ['id', 'workspace_id', 'alert_type', 'symbol', 'thesis_id', 'watchlist_item_id', 'trigger_key', 'created_at', 'read_at', 'message', 'payload'],
        properties: {
          id: { type: ['string', 'null'] },
          workspace_id: { type: 'string' },
          alert_type: { type: 'string' },
          symbol: { type: 'string' },
          thesis_id: { type: ['string', 'null'] },
          watchlist_item_id: { type: ['string', 'null'] },
          trigger_key: { type: ['string', 'null'] },
          created_at: { type: ['string', 'null'] },
          read_at: { type: ['string', 'null'] },
          message: { type: 'string' },
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

function pathParameter(name: string) {
  return {
    name,
    in: 'path',
    required: true,
    schema: { type: 'string' },
  } as const;
}

function queryParameter(
  name: string,
  schema: Record<string, unknown>,
) {
  return {
    name,
    in: 'query',
    required: false,
    schema,
  } as const;
}

function limitParameter(defaultValue: number, maxValue: number) {
  return queryParameter('limit', {
    type: 'integer',
    minimum: 1,
    maximum: maxValue,
    default: defaultValue,
  });
}

function jsonRequest(schemaName: string) {
  return {
    required: true,
    content: {
      'application/json': {
        schema: { $ref: `#/components/schemas/${schemaName}` },
      },
    },
  } as const;
}

function jsonResponse(
  description: string,
  schemaName: string,
  status = '200',
) {
  return {
    [status]: {
      description,
      content: {
        'application/json': {
          schema: { $ref: `#/components/schemas/${schemaName}` },
        },
      },
    },
  } as const;
}

function jsonArrayResponse(description: string, schemaName: string) {
  return {
    '200': {
      description,
      content: {
        'application/json': {
          schema: {
            type: 'array',
            items: { $ref: `#/components/schemas/${schemaName}` },
          },
        },
      },
    },
  } as const;
}
