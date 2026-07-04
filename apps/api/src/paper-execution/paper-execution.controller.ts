import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { PaperExecutionService } from './paper-execution.service';
import type {
  CloseSimulationRequest,
  CreateSimulationRequest,
} from './paper-execution.types';

@Controller()
export class PaperExecutionController {
  constructor(private readonly paperExecution: PaperExecutionService) {}

  @Post('playbooks/:id/simulations')
  createSimulation(
    @Param('id') id: string,
    @Body() request: CreateSimulationRequest = {},
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.paperExecution.createSimulation(id, request, userId, workspaceId);
  }

  @Get('playbooks/:id/simulations')
  listForPlaybook(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.paperExecution.listForPlaybook(id, userId, workspaceId);
  }

  @Get('simulations/:id')
  getSimulation(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.paperExecution.getSimulation(id, userId, workspaceId);
  }

  @Post('simulations/:id/refresh')
  refreshSimulation(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.paperExecution.refreshSimulation(id, userId, workspaceId);
  }

  @Post('simulations/:id/cancel')
  cancelSimulation(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.paperExecution.cancelSimulation(id, userId, workspaceId);
  }

  @Post('simulations/:id/close')
  closeSimulation(
    @Param('id') id: string,
    @Body() request: CloseSimulationRequest,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.paperExecution.closeSimulation(id, request, userId, workspaceId);
  }

  @Get('simulations/:id/events')
  listEvents(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.paperExecution.listEvents(id, userId, workspaceId);
  }

  @Get('simulations/:id/orders')
  listOrders(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.paperExecution.listOrders(id, userId, workspaceId);
  }

  @Get('simulations/:id/position')
  getPosition(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.paperExecution.getPosition(id, userId, workspaceId);
  }

  @Get('simulations/:id/outcome')
  getOutcome(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.paperExecution.getOutcome(id, userId, workspaceId);
  }
}
