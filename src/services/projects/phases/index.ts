/**
 * Phase Operations - Re-exports from neonPhaseService
 */

import { phaseOperations, stepOperations, taskOperations, progressCalculations, phaseGenerator } from './neonPhaseService';

export const generateProjectPhases = phaseGenerator.generateDefaultPhases;
export const getProjectPhases = phaseOperations.getProjectPhases;
export const getPhaseById = phaseOperations.getPhaseById;
export const updatePhase = phaseOperations.updatePhase;
export const getPhaseSteps = stepOperations.getPhaseSteps;
export const updateStep = stepOperations.updateStep;
export const getStepTasks = taskOperations.getStepTasks;
export const createTask = taskOperations.createTask;
export const updateTask = taskOperations.updateTask;
export const updateProjectProgress = progressCalculations.updateProjectProgress;
export const updatePhaseProgress = progressCalculations.updatePhaseProgress;
export const updateStepProgress = progressCalculations.updateStepProgress;
