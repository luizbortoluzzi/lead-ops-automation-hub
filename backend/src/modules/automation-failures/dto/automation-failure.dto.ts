import { z } from 'zod';
import { ERROR_TYPES } from '../../../common/errors/error-classification';
import {
  AUTOMATION_FAILURE_STATUSES,
  AUTOMATION_OPERATIONS,
} from '../enums/automation-failure.enums';

export const createAutomationFailureSchema = z.object({
  correlationId: z.string().trim().max(128).optional(),
  workflowName: z.string().trim().min(1).max(255),
  executionId: z.string().trim().max(255).optional(),
  nodeName: z.string().trim().max(255).optional(),
  operation: z.enum(AUTOMATION_OPERATIONS),
  errorType: z.enum(ERROR_TYPES),
  errorCode: z.string().trim().max(100).optional(),
  statusCode: z.coerce.number().int().min(100).max(599).optional(),
  retryable: z.boolean().default(false),
  attempt: z.coerce.number().int().min(1).max(100).default(1),
  message: z.string().trim().min(1).max(2000),
  payload: z.unknown().optional(),
});
export type CreateAutomationFailureDto = z.infer<typeof createAutomationFailureSchema>;

export const listAutomationFailuresQuerySchema = z.object({
  status: z.enum(AUTOMATION_FAILURE_STATUSES).optional(),
  errorType: z.enum(ERROR_TYPES).optional(),
  correlationId: z.string().trim().max(128).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListAutomationFailuresQuery = z.infer<typeof listAutomationFailuresQuerySchema>;

export const resolveAutomationFailureSchema = z.object({
  resolutionNote: z.string().trim().max(1000).optional(),
});
export type ResolveAutomationFailureDto = z.infer<typeof resolveAutomationFailureSchema>;
