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
    '/research-runs/{id}/evidence-bundle': {
      get: {
        operationId: 'getResearchRunEvidenceBundle',
        tags: ['research-runs'],
        parameters: [pathParameter('id')],
        responses: jsonResponse(
          'Evidence bundle export for a research run.',
          'EvidenceBundleResponse',
        ),
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
    '/journal/runs/{id}/evidence-bundle': {
      get: {
        operationId: 'getJournalRunEvidenceBundle',
        tags: ['journal'],
        parameters: [pathParameter('id')],
        responses: jsonResponse(
          'Evidence bundle export for a journal run.',
          'EvidenceBundleResponse',
        ),
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
    '/signals/{id}': {
      get: {
        operationId: 'getSignal',
        tags: ['signals'],
        parameters: [pathParameter('id')],
        responses: jsonResponse(
          'Workspace-scoped signal with provenance detail.',
          'SignalDetailResponse',
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
    '/alerts/scheduler': {
      get: {
        operationId: 'getAlertSchedulerStatus',
        tags: ['alerts'],
        responses: jsonResponse(
          'Alert scheduler status for the active workspace.',
          'AlertSchedulerStatusResponse',
        ),
      },
    },
    '/alerts/scheduler/run': {
      post: {
        operationId: 'runAlertScheduler',
        tags: ['alerts'],
        responses: jsonResponse(
          'Manual alert scheduler run result.',
          'WatchlistPollResponse',
          '201',
        ),
      },
    },
    '/performance/outcomes': {
      get: {
        operationId: 'listPerformanceOutcomes',
        tags: ['performance'],
        parameters: [
          queryParameter('symbol', { type: 'string' }),
          limitParameter(100, 500),
        ],
        responses: jsonArrayResponse(
          'Outcome reviews with thesis metadata.',
          'PerformanceOutcomeReviewResponse',
        ),
      },
    },
    '/performance/analytics': {
      get: {
        operationId: 'getPerformanceAnalytics',
        tags: ['performance'],
        parameters: [
          queryParameter('symbol', { type: 'string' }),
          limitParameter(200, 500),
        ],
        responses: jsonResponse(
          'Aggregate performance analytics.',
          'PerformanceAnalyticsResponse',
        ),
      },
    },
    '/performance/trend': {
      get: {
        operationId: 'getPerformanceTrend',
        tags: ['performance'],
        parameters: [queryParameter('days', { type: 'integer', default: 90 })],
        responses: jsonArrayResponse(
          'Weekly performance trend.',
          'PerformanceTrendPointResponse',
        ),
      },
    },
    '/performance/health': {
      get: {
        operationId: 'getPerformanceHealth',
        tags: ['performance'],
        parameters: [
          queryParameter('recent_days', { type: 'integer', default: 14 }),
          queryParameter('baseline_days', { type: 'integer', default: 60 }),
        ],
        responses: jsonResponse(
          'Performance degradation health check.',
          'PerformanceHealthResponse',
        ),
      },
    },
    '/comparisons/theses': {
      get: {
        operationId: 'compareTheses',
        tags: ['comparisons'],
        parameters: [
          queryParameter('left_id', { type: 'string' }),
          queryParameter('right_id', { type: 'string' }),
        ],
        responses: jsonResponse('Thesis diff.', 'ComparisonResponse'),
      },
    },
    '/comparisons/runs': {
      get: {
        operationId: 'compareRuns',
        tags: ['comparisons'],
        parameters: [
          queryParameter('left_id', { type: 'string' }),
          queryParameter('right_id', { type: 'string' }),
        ],
        responses: jsonResponse('Run diff.', 'ComparisonResponse'),
      },
    },
    '/scenarios/monitor': {
      get: {
        operationId: 'getScenarioMonitor',
        tags: ['scenarios'],
        parameters: [
          queryParameter('symbol', { type: 'string' }),
          queryParameter('status', { type: 'string' }),
          limitParameter(100, 300),
        ],
        responses: jsonResponse(
          'Scenario monitoring radar.',
          'ScenarioMonitorResponse',
        ),
      },
    },
    '/operations/health': {
      get: {
        operationId: 'getOperationsHealth',
        tags: ['operations'],
        parameters: [limitParameter(50, 200)],
        responses: jsonResponse(
          'Provider, LLM, and freshness health.',
          'OperationsHealthResponse',
        ),
      },
    },
    '/operations/provider-health': {
      get: {
        operationId: 'listProviderHealth',
        tags: ['operations'],
        parameters: [limitParameter(50, 200)],
        responses: jsonArrayResponse(
          'Provider health rows.',
          'ProviderHealthResponse',
        ),
      },
    },
    '/operations/llm-calls': {
      get: {
        operationId: 'listLlmCalls',
        tags: ['operations'],
        parameters: [limitParameter(50, 200)],
        responses: jsonArrayResponse('LLM call rows.', 'LlmCallResponse'),
      },
    },
    '/operations/data-freshness': {
      get: {
        operationId: 'listDataFreshness',
        tags: ['operations'],
        parameters: [limitParameter(50, 200)],
        responses: jsonArrayResponse(
          'Data freshness checks.',
          'DataFreshnessResponse',
        ),
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
        required: ['id', 'workspace_id', 'debate_id', 'research_run_id', 'agent_name', 'agent_role', 'stance', 'confidence', 'data_quality', 'data_quality_label', 'reason_codes', 'created_at', 'payload'],
        properties: {
          id: { type: ['string', 'null'] },
          workspace_id: { type: 'string' },
          debate_id: { type: ['string', 'null'] },
          research_run_id: { type: ['string', 'null'] },
          agent_name: { type: 'string' },
          agent_role: { type: 'string' },
          stance: { type: 'string' },
          confidence: { type: ['number', 'null'] },
          data_quality: { type: ['number', 'null'] },
          data_quality_label: { type: 'string' },
          reason_codes: { type: 'array', items: { type: 'string' } },
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
          'missing_data_reason_codes',
          'data_quality',
          'data_quality_label',
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
          missing_data_reason_codes: { type: 'array', items: { type: 'string' } },
          data_quality: { type: ['number', 'null'] },
          data_quality_label: { type: 'string' },
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
        required: ['id', 'workspace_id', 'thesis_id', 'action', 'user_notes', 'entry', 'stop_loss', 'take_profit', 'position_intent', 'decided_at'],
        properties: {
          id: { type: ['string', 'null'] },
          workspace_id: { type: 'string' },
          thesis_id: { type: 'string' },
          action: { type: 'string' },
          user_notes: { type: 'string' },
          entry: { type: 'string' },
          stop_loss: { type: 'string' },
          take_profit: { type: 'string' },
          position_intent: { type: 'string' },
          decided_at: { type: ['string', 'null'] },
        },
      },
      ThesisReviewResponse: {
        type: 'object',
        required: ['id', 'workspace_id', 'thesis_id', 'result', 'lessons', 'max_favorable_excursion', 'max_adverse_excursion', 'reviewed_at', 'invalidated'],
        properties: {
          id: { type: ['string', 'null'] },
          workspace_id: { type: 'string' },
          thesis_id: { type: 'string' },
          result: { type: 'string' },
          lessons: { type: 'string' },
          max_favorable_excursion: { type: ['number', 'null'] },
          max_adverse_excursion: { type: ['number', 'null'] },
          reviewed_at: { type: ['string', 'null'] },
          invalidated: { type: 'boolean' },
        },
      },
      PerformanceOutcomeReviewResponse: {
        type: 'object',
        required: ['id', 'workspace_id', 'thesis_id', 'result', 'lessons', 'max_favorable_excursion', 'max_adverse_excursion', 'reviewed_at', 'invalidated', 'symbol', 'direction', 'setup_type', 'confidence', 'thesis_created_at'],
        properties: {
          id: { type: ['string', 'null'] },
          workspace_id: { type: 'string' },
          thesis_id: { type: 'string' },
          result: { type: 'string' },
          lessons: { type: 'string' },
          max_favorable_excursion: { type: ['number', 'null'] },
          max_adverse_excursion: { type: ['number', 'null'] },
          reviewed_at: { type: ['string', 'null'] },
          invalidated: { type: 'boolean' },
          symbol: { type: 'string' },
          direction: { type: 'string' },
          setup_type: { type: 'string' },
          confidence: { type: ['number', 'null'] },
          thesis_created_at: { type: ['string', 'null'] },
        },
      },
      RetrospectiveInsightResponse: {
        type: 'object',
        required: ['insight_type', 'message', 'thesis_ids', 'evidence_count'],
        properties: {
          insight_type: { type: 'string' },
          message: { type: 'string' },
          thesis_ids: { type: 'array', items: { type: 'string' } },
          evidence_count: { type: 'integer' },
        },
      },
      PerformanceAnalyticsResponse: {
        type: 'object',
        required: ['sample_size', 'symbol', 'result_counts', 'hit_rate', 'invalidation_rate', 'mixed_rate', 'average_mfe', 'average_mae', 'reviewed_thesis_ids', 'recent_lessons', 'insights'],
        properties: {
          sample_size: { type: 'integer' },
          symbol: { type: ['string', 'null'] },
          result_counts: { type: 'object', additionalProperties: { type: 'integer' } },
          hit_rate: { type: ['number', 'null'] },
          invalidation_rate: { type: ['number', 'null'] },
          mixed_rate: { type: ['number', 'null'] },
          average_mfe: { type: ['number', 'null'] },
          average_mae: { type: ['number', 'null'] },
          reviewed_thesis_ids: { type: 'array', items: { type: 'string' } },
          recent_lessons: { type: 'array', items: { type: 'string' } },
          insights: { type: 'array', items: { $ref: '#/components/schemas/RetrospectiveInsightResponse' } },
        },
      },
      PerformanceTrendPointResponse: {
        type: 'object',
        required: ['week_start', 'sample_size', 'hit_rate', 'average_mfe', 'average_mae', 'calibration_quality'],
        properties: {
          week_start: { type: 'string', format: 'date' },
          sample_size: { type: 'integer' },
          hit_rate: { type: ['number', 'null'] },
          average_mfe: { type: ['number', 'null'] },
          average_mae: { type: ['number', 'null'] },
          calibration_quality: { type: 'string' },
        },
      },
      PerformanceHealthResponse: {
        type: 'object',
        required: ['overall_status', 'recent_sample_size', 'baseline_sample_size', 'recent_hit_rate', 'baseline_hit_rate', 'alerts', 'recommendation'],
        properties: {
          overall_status: { type: 'string' },
          recent_sample_size: { type: 'integer' },
          baseline_sample_size: { type: 'integer' },
          recent_hit_rate: { type: ['number', 'null'] },
          baseline_hit_rate: { type: ['number', 'null'] },
          alerts: { type: 'array', items: { type: 'string' } },
          recommendation: { type: 'string' },
        },
      },
      DiffFieldResponse: {
        type: 'object',
        required: ['changed'],
        additionalProperties: true,
        properties: {
          changed: { type: 'boolean' },
        },
      },
      ComparisonResponse: {
        type: 'object',
        required: ['kind', 'id_a', 'id_b', 'direction_flip', 'changed_fields', 'changed_count', 'change_severity', 'severity_reasons', 'fields'],
        properties: {
          kind: { type: 'string', enum: ['thesis_diff', 'run_diff'] },
          id_a: { type: 'string' },
          id_b: { type: 'string' },
          cross_symbol: { type: 'boolean' },
          direction_flip: { type: 'boolean' },
          changed_fields: { type: 'array', items: { type: 'string' } },
          changed_count: { type: 'integer' },
          change_severity: { type: 'string' },
          severity_reasons: { type: 'array', items: { type: 'string' } },
          fields: {
            type: 'object',
            additionalProperties: { $ref: '#/components/schemas/DiffFieldResponse' },
          },
          thesis_diff: { anyOf: [{ $ref: '#/components/schemas/ComparisonResponse' }, { type: 'null' }] },
        },
      },
      RecordThesisDecisionRequest: {
        type: 'object',
        required: ['action'],
        properties: {
          action: { type: 'string', minLength: 1 },
          notes: { type: 'string' },
          entry: { type: 'string' },
          stop_loss: { type: 'string' },
          take_profit: { type: 'string' },
          position_intent: { type: 'string' },
        },
      },
      RecordThesisReviewRequest: {
        type: 'object',
        required: ['result'],
        properties: {
          result: { type: 'string', minLength: 1 },
          notes: { type: 'string' },
          max_favorable_excursion: { type: 'number' },
          max_adverse_excursion: { type: 'number' },
        },
      },
      SignalResponse: {
        type: 'object',
        required: ['id', 'workspace_id', 'research_run_id', 'signal_snapshot_id', 'symbol', 'signal_type', 'direction', 'confidence', 'observed_at', 'source', 'source_timestamp', 'summary'],
        properties: {
          id: { type: ['string', 'null'] },
          workspace_id: { type: 'string' },
          research_run_id: { type: ['string', 'null'] },
          signal_snapshot_id: { type: ['string', 'null'] },
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
      SignalDetailResponse: {
        type: 'object',
        required: [
          'id',
          'workspace_id',
          'symbol',
          'signal_type',
          'direction',
          'confidence',
          'observed_at',
          'source',
          'source_timestamp',
          'summary',
          'expires_at',
          'evidence_lane',
          'evidence_category',
          'strength',
          'heuristic_confidence',
          'empirical_confidence',
          'empirical_confidence_sample_size',
          'empirical_confidence_oos_sample_size',
          'confidence_version',
          'freshness_status',
          'is_stale',
          'age_seconds',
          'staleness_reason',
          'research_run_id',
          'signal_snapshot_id',
          'provenance',
          'evidence',
          'watch_conditions',
          'payload',
        ],
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
          expires_at: { type: ['string', 'null'] },
          evidence_lane: { type: 'string' },
          evidence_category: { type: 'string' },
          strength: { type: ['number', 'null'] },
          heuristic_confidence: { type: ['number', 'null'] },
          empirical_confidence: { type: ['number', 'null'] },
          empirical_confidence_sample_size: { type: ['number', 'null'] },
          empirical_confidence_oos_sample_size: { type: ['number', 'null'] },
          confidence_version: { type: 'string' },
          freshness_status: { type: 'string' },
          is_stale: { type: 'boolean' },
          age_seconds: { type: ['number', 'null'] },
          staleness_reason: { type: 'string' },
          research_run_id: { type: ['string', 'null'] },
          signal_snapshot_id: { type: ['string', 'null'] },
          provenance: { $ref: '#/components/schemas/JsonRecord' },
          evidence: { $ref: '#/components/schemas/JsonRecord' },
          watch_conditions: { $ref: '#/components/schemas/JsonRecord' },
          payload: { $ref: '#/components/schemas/JsonRecord' },
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
      WatchlistPollResponse: {
        type: 'object',
        required: ['checked_watchlists', 'alerts_created', 'skipped_items'],
        properties: {
          checked_watchlists: { type: 'integer' },
          alerts_created: { type: 'integer' },
          skipped_items: { type: 'array', items: { type: 'string' } },
        },
      },
      AlertSchedulerStatusResponse: {
        type: 'object',
        required: ['enabled', 'configured_by_env', 'interval_ms', 'poll_on_start', 'limit', 'running', 'last_run_at', 'last_error', 'last_result', 'workspace_enabled_watchlists'],
        properties: {
          enabled: { type: 'boolean' },
          configured_by_env: { type: 'boolean' },
          interval_ms: { type: 'integer' },
          poll_on_start: { type: 'boolean' },
          limit: { type: 'integer' },
          running: { type: 'boolean' },
          last_run_at: { type: ['string', 'null'] },
          last_error: { type: ['string', 'null'] },
          last_result: { anyOf: [{ $ref: '#/components/schemas/WatchlistPollResponse' }, { type: 'null' }] },
          workspace_enabled_watchlists: { type: 'integer' },
        },
      },
      ScenarioMonitorItemResponse: {
        type: 'object',
        required: ['status', 'status_reason', 'trigger_summary', 'risk_count', 'scenario', 'thesis', 'latest_market_snapshot', 'latest_alert'],
        properties: {
          status: { type: 'string' },
          status_reason: { type: 'string' },
          trigger_summary: { type: 'string' },
          risk_count: { type: 'integer' },
          scenario: { $ref: '#/components/schemas/ScenarioResponse' },
          thesis: { $ref: '#/components/schemas/ThesisResponse' },
          latest_market_snapshot: { anyOf: [{ $ref: '#/components/schemas/MarketSnapshotResponse' }, { type: 'null' }] },
          latest_alert: { anyOf: [{ $ref: '#/components/schemas/AlertResponse' }, { type: 'null' }] },
        },
      },
      ScenarioMonitorResponse: {
        type: 'object',
        required: ['workspace_id', 'generated_at', 'total_scenarios', 'status_counts', 'items'],
        properties: {
          workspace_id: { type: 'string' },
          generated_at: { type: 'string' },
          total_scenarios: { type: 'integer' },
          status_counts: { type: 'object', additionalProperties: { type: 'integer' } },
          items: { type: 'array', items: { $ref: '#/components/schemas/ScenarioMonitorItemResponse' } },
        },
      },
      ProviderHealthResponse: {
        type: 'object',
        required: ['id', 'provider', 'component', 'status', 'checked_at', 'latency_ms', 'error_type', 'error_message', 'payload'],
        properties: {
          id: { type: ['string', 'null'] },
          provider: { type: 'string' },
          component: { type: ['string', 'null'] },
          status: { type: 'string' },
          checked_at: { type: ['string', 'null'] },
          latency_ms: { type: ['number', 'null'] },
          error_type: { type: ['string', 'null'] },
          error_message: { type: ['string', 'null'] },
          payload: { $ref: '#/components/schemas/JsonRecord' },
        },
      },
      LlmCallResponse: {
        type: 'object',
        required: ['id', 'workspace_id', 'research_run_id', 'thesis_id', 'provider', 'model', 'stage', 'agent', 'input_tokens', 'output_tokens', 'latency_ms', 'status', 'error_type', 'error_message', 'created_at', 'payload'],
        properties: {
          id: { type: ['string', 'null'] },
          workspace_id: { type: ['string', 'null'] },
          research_run_id: { type: ['string', 'null'] },
          thesis_id: { type: ['string', 'null'] },
          provider: { type: 'string' },
          model: { type: 'string' },
          stage: { type: ['string', 'null'] },
          agent: { type: ['string', 'null'] },
          input_tokens: { type: 'integer' },
          output_tokens: { type: 'integer' },
          latency_ms: { type: ['number', 'null'] },
          status: { type: 'string' },
          error_type: { type: ['string', 'null'] },
          error_message: { type: ['string', 'null'] },
          created_at: { type: ['string', 'null'] },
          payload: { $ref: '#/components/schemas/JsonRecord' },
        },
      },
      DataFreshnessResponse: {
        type: 'object',
        required: ['id', 'workspace_id', 'research_run_id', 'symbol', 'source', 'source_timestamp', 'observed_timestamp', 'age_seconds', 'threshold_seconds', 'status', 'payload'],
        properties: {
          id: { type: ['string', 'null'] },
          workspace_id: { type: ['string', 'null'] },
          research_run_id: { type: ['string', 'null'] },
          symbol: { type: ['string', 'null'] },
          source: { type: 'string' },
          source_timestamp: { type: ['string', 'null'] },
          observed_timestamp: { type: ['string', 'null'] },
          age_seconds: { type: ['number', 'null'] },
          threshold_seconds: { type: ['number', 'null'] },
          status: { type: 'string' },
          payload: { $ref: '#/components/schemas/JsonRecord' },
        },
      },
      LlmHealthSummaryResponse: {
        type: 'object',
        required: ['total_calls', 'success_rate', 'total_tokens', 'average_latency_ms', 'recent_errors', 'by_provider'],
        properties: {
          total_calls: { type: 'integer' },
          success_rate: { type: ['number', 'null'] },
          total_tokens: { type: 'integer' },
          average_latency_ms: { type: ['number', 'null'] },
          recent_errors: { type: 'integer' },
          by_provider: { type: 'object', additionalProperties: true },
        },
      },
      OperationsHealthResponse: {
        type: 'object',
        required: ['generated_at', 'providers', 'llm', 'freshness', 'queue'],
        properties: {
          generated_at: { type: 'string' },
          providers: { type: 'array', items: { $ref: '#/components/schemas/ProviderHealthResponse' } },
          llm: { $ref: '#/components/schemas/LlmHealthSummaryResponse' },
          freshness: { type: 'object', additionalProperties: true },
          queue: { type: 'object', additionalProperties: true },
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
      EvidenceBundleResponse: {
        type: 'object',
        required: [
          'schema_version',
          'exported_at',
          'workspace_id',
          'research_run_id',
          'symbol',
          'source',
          'run',
          'events',
          'snapshots',
          'debate',
          'thesis',
          'scenarios',
          'signal_details',
          'artifacts',
        ],
        properties: {
          schema_version: { type: 'string', enum: ['evidence_bundle.v1'] },
          exported_at: { type: 'string' },
          workspace_id: { type: 'string' },
          research_run_id: { type: 'string' },
          symbol: { type: 'string' },
          source: { type: 'string', enum: ['api'] },
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
          signal_details: {
            type: 'array',
            items: { $ref: '#/components/schemas/SignalDetailResponse' },
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
