/**
 * OpenAPI 3 document for A&F bi-directional event bus + REST sketch
 * (Spec - API Webhooks).
 */

export const AF_OPENAPI_VERSION = '1.0.0';

export function buildAfOpenApiDocument(baseUrl = 'https://app.tagevc.com') {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Tage VC Accounting & Finance API',
      version: AF_OPENAPI_VERSION,
      description:
        'Idempotent events and REST resources from Spec - API Webhooks. Money fields are integer cents + currency in wire format; portal UI may display dollars.',
    },
    servers: [{ url: `${baseUrl}/api/af` }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: {
                  type: 'string',
                  enum: [
                    'VALIDATION',
                    'NOT_FOUND',
                    'CONFLICT',
                    'PERIOD_LOCKED',
                    'SOD_VIOLATION',
                    'INSUFFICIENT_CASH',
                  ],
                },
                message: { type: 'string' },
                details: { type: 'array', items: { type: 'object' } },
              },
              required: ['code', 'message'],
            },
          },
        },
        EventEnvelope: {
          type: 'object',
          required: [
            'event_id',
            'event_type',
            'occurred_at',
            'source_system',
            'payload',
          ],
          properties: {
            event_id: { type: 'string', format: 'uuid' },
            event_type: { type: 'string' },
            occurred_at: { type: 'string', format: 'date-time' },
            entity_code: {
              type: 'string',
              enum: ['TVC', 'R619', 'SHR', 'INDA', 'ORG', 'PERS', 'CONSOL'],
              nullable: true,
            },
            source_system: { type: 'string' },
            payload: { type: 'object', additionalProperties: true },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      '/events': {
        get: {
          summary: 'List recent A&F events',
          parameters: [
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', default: 40, maximum: 200 },
            },
          ],
          responses: {
            '200': {
              description: 'Event list',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      events: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/EventEnvelope' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          summary: 'Publish internal/outbound event',
          parameters: [
            {
              name: 'Idempotency-Key',
              in: 'header',
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/EventEnvelope' },
              },
            },
          },
          responses: {
            '200': { description: 'Accepted (or duplicate)' },
            '400': {
              description: 'Validation',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/webhooks/inbound': {
        post: {
          summary: 'OS → Accounting inbound webhook',
          description:
            'sale.created | sale.updated | customer.upsert | placement.created. Idempotency-Key = event_id.',
          parameters: [
            {
              name: 'Idempotency-Key',
              in: 'header',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/EventEnvelope' },
              },
            },
          },
          responses: {
            '200': { description: 'Processed' },
            '409': { description: 'Duplicate event_id' },
          },
        },
      },
      '/entities': {
        get: {
          summary: 'List entities',
          responses: { '200': { description: 'Entity list' } },
        },
      },
      '/invoices': {
        get: {
          summary: 'List invoices',
          parameters: [
            { name: 'entity_code', in: 'query', schema: { type: 'string' } },
            { name: 'date_from', in: 'query', schema: { type: 'string' } },
            { name: 'date_to', in: 'query', schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'Invoice list' } },
        },
      },
      '/bills': {
        get: {
          summary: 'List bills',
          responses: { '200': { description: 'Bill list' } },
        },
      },
      '/reports/kpis': {
        get: {
          summary: 'Entity KPIs',
          responses: { '200': { description: 'KPI snapshot' } },
        },
      },
    },
  } as const;
}

export const INBOUND_EVENT_TYPES = [
  'sale.created',
  'sale.updated',
  'customer.upsert',
  'placement.created',
] as const;

export const OUTBOUND_EVENT_TYPES = [
  'invoice.status_changed',
  'commission.accrued',
  'commission.paid',
  'waterfall.allocated',
  'ar.balance_updated',
  'customer.sync_ack',
] as const;

export const INTERNAL_EVENT_TYPES = [
  'invoice.sent',
  'invoice.viewed',
  'invoice.partial_paid',
  'invoice.paid',
  'invoice.void',
  'payment.failed',
  'bill.submitted',
  'bill.approved',
  'bill.paid',
  'bank.txn.imported',
  'card.txn.imported',
] as const;
