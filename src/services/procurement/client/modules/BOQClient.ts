/**
 * BOQ Client Module
 * Bill of Quantities operations for procurement client service
 */

import { procurementApi } from '@/services/api/procurementApi';
import type { BOQ } from '@/services/api/procurementApi';
import type { ProcurementApiContext } from '../../index';
import type { BOQWithItems, BOQItem, BOQException } from '../../boqApi/types';

export class BOQClient {
  // BOQ Operations
  static async getBOQsByProject(
    context: ProcurementApiContext,
    projectId: string
  ): Promise<BOQ[]> {
    const response = await procurementApi.boq.getBOQs(projectId);
    // API returns {boqs: [...], items: [...], stats: {...}}
    return (response as any).boqs || (response as any).data || [];
  }

  static async getBOQ(
    context: ProcurementApiContext,
    boqId: string
  ): Promise<BOQ> {
    return procurementApi.boq.getBOQ(context.projectId, boqId);
  }

  static async getBOQWithItems(
    context: ProcurementApiContext,
    boqId: string
  ): Promise<BOQWithItems> {
    const [boq, items, exceptions] = await Promise.all([
      procurementApi.boq.getBOQ(context.projectId, boqId),
      procurementApi.boq.getItems(context.projectId, boqId),
      procurementApi.boq.getExceptions(context.projectId, boqId)
    ]);

    return {
      ...boq,
      items: items as BOQItem[],
      exceptions: exceptions as BOQException[],
    } as unknown as BOQWithItems;
  }

  static async createBOQ(
    context: ProcurementApiContext,
    boqData: Partial<BOQ>
  ): Promise<BOQ> {
    return procurementApi.boq.createBOQ(context.projectId, {
      ...boqData,
      createdBy: context.userId
    });
  }

  static async updateBOQ(
    context: ProcurementApiContext,
    boqId: string,
    updateData: Partial<BOQ>
  ): Promise<BOQ> {
    return procurementApi.boq.updateBOQ(context.projectId, boqId, updateData);
  }

  static async deleteBOQ(
    context: ProcurementApiContext,
    boqId: string
  ): Promise<void> {
    return procurementApi.boq.deleteBOQ(context.projectId, boqId);
  }

  static async importBOQ(
    context: ProcurementApiContext,
    importData: { name: string; data: any[]; mappings?: Record<string, string> }
  ): Promise<BOQ> {
    return procurementApi.boq.importBOQ(context.projectId, importData);
  }

  // BOQ Item Operations
  static async getBOQItems(
    context: ProcurementApiContext,
    boqId: string
  ): Promise<BOQItem[]> {
    const items = await procurementApi.boq.getItems(context.projectId, boqId);
    return items as BOQItem[];
  }

  static async getBOQItem(
    context: ProcurementApiContext,
    itemId: string
  ): Promise<BOQItem> {
    // Since there's no direct endpoint for single item, we'll need to fetch all and filter
    // This should be improved with a proper API endpoint
    throw new Error('getBOQItem not implemented - API endpoint needed');
  }

  static async createBOQItem(
    context: ProcurementApiContext,
    boqId: string,
    itemData: Partial<BOQItem>
  ): Promise<BOQItem> {
    // This needs a proper API endpoint
    throw new Error('createBOQItem not implemented - API endpoint needed');
  }

  static async updateBOQItem(
    context: ProcurementApiContext,
    itemId: string,
    updateData: Partial<BOQItem>
  ): Promise<BOQItem> {
    // This needs a proper API endpoint
    throw new Error('updateBOQItem not implemented - API endpoint needed');
  }

  static async deleteBOQItem(
    context: ProcurementApiContext,
    itemId: string
  ): Promise<void> {
    // This needs a proper API endpoint
    throw new Error('deleteBOQItem not implemented - API endpoint needed');
  }

  // BOQ Exception Operations
  static async getBOQExceptions(
    context: ProcurementApiContext,
    boqId: string
  ): Promise<BOQException[]> {
    const exceptions = await procurementApi.boq.getExceptions(context.projectId, boqId);
    return exceptions as BOQException[];
  }

  static async getBOQException(
    context: ProcurementApiContext,
    exceptionId: string
  ): Promise<BOQException> {
    // This needs a proper API endpoint
    throw new Error('getBOQException not implemented - API endpoint needed');
  }

  static async createBOQException(
    context: ProcurementApiContext,
    boqId: string,
    exceptionData: Partial<BOQException>
  ): Promise<BOQException> {
    // This needs a proper API endpoint
    throw new Error('createBOQException not implemented - API endpoint needed');
  }

  static async updateBOQException(
    context: ProcurementApiContext,
    exceptionId: string,
    updateData: Partial<BOQException>
  ): Promise<BOQException> {
    // This needs a proper API endpoint
    throw new Error('updateBOQException not implemented - API endpoint needed');
  }

  static async deleteException(
    context: ProcurementApiContext,
    exceptionId: string
  ): Promise<void> {
    // This needs a proper API endpoint
    throw new Error('deleteException not implemented - API endpoint needed');
  }
}
