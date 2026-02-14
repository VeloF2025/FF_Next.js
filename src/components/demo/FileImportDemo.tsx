/**
 * File Import Demo Component
 * Demonstrates the new high-performance file import capabilities
 */

import React, { useState, useCallback } from 'react';
import { Upload, FileText, BarChart3, Clock, Cpu } from 'lucide-react';
import { FileImportUtils, FileImportBenchmark } from '@/services/fileImport';
import type { FileProcessingResult } from '@/services/fileImport';

interface BenchmarkResult {
  strategy: string;
  processingTime: number;
  memoryPeak: number;
  rowsPerSecond: number;
  success: boolean;
  error?: string;
}

interface FileImportBenchmarkResult {
  file: {
    name: string;
    size: number;
    type: string;
  };
  results: BenchmarkResult[];
  recommendation: string;
}

interface DemoState {
  file: File | null;
  processing: boolean;
  progress: number;
  result: FileProcessingResult | null;
  error: string | null;
  benchmark: FileImportBenchmarkResult | null;
  logs: string[];
}

export function FileImportDemo() {
  const [state, setState] = useState<DemoState>({
    file: null,
    processing: false,
    progress: 0,
    result: null,
    error: null,
    benchmark: null,
    logs: []
  });

  const addLog = useCallback((message: string) => {
    setState(prev => ({
      ...prev,
      logs: [...prev.logs.slice(-9), `${new Date().toLocaleTimeString()}: ${message}`]
    }));
  }, []);

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setState(prev => ({
        ...prev,
        file,
        result: null,
        error: null,
        benchmark: null,
        logs: []
      }));
      addLog(`Selected file: ${file.name} (${FileImportUtils.formatFileSize(file.size)})`);
    }
  }, [addLog]);

  const handleProcess = useCallback(async () => {
    if (!state.file) return;

    setState(prev => ({ ...prev, processing: true, progress: 0, error: null }));
    addLog('Starting file processing...');

    try {
      // Validate file first
      addLog('Validating file...');
      const validation = await FileImportUtils.validateFile(state.file);
      
      if (!validation.isValid) {
        throw new Error(`File validation failed: ${validation.errors.join(', ')}`);
      }
      
      addLog('File validation passed');
      
      // Get processing strategy
      const strategy = FileImportUtils.getRecommendedStrategy(state.file);
      addLog(`Using ${strategy} processing strategy`);

      // Process file
      const result = await FileImportUtils.processFile(state.file, {
        onProgress: (progress) => {
          setState(prev => ({ ...prev, progress }));
          addLog(`Progress: ${Math.round(progress)}%`);
        },
        onError: (error) => {
          addLog(`Error: ${error}`);
        },
        useStreaming: strategy === 'streaming'
      });

      setState(prev => ({ 
        ...prev, 
        result, 
        processing: false, 
        progress: 100 
      }));

      addLog(`Processing completed: ${result.rowsProcessed} rows processed in ${Math.round(result.processingTime)}ms`);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setState(prev => ({ 
        ...prev, 
        error: errorMessage, 
        processing: false 
      }));
      addLog(`Error: ${errorMessage}`);
    }
  }, [state.file, addLog]);

  const handleBenchmark = useCallback(async () => {
    if (!state.file) return;

    setState(prev => ({ ...prev, processing: true }));
    addLog('Starting benchmark...');

    try {
      const benchmark = await FileImportBenchmark.benchmark(state.file);
      setState(prev => ({ 
        ...prev, 
        benchmark, 
        processing: false 
      }));
      addLog(`Benchmark completed: ${benchmark.recommendation}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Benchmark failed';
      setState(prev => ({ 
        ...prev, 
        error: errorMessage, 
        processing: false 
      }));
      addLog(`Benchmark error: ${errorMessage}`);
    }
  }, [state.file, addLog]);

  const renderFileInfo = () => {
    if (!state.file) return null;

    const fileType = FileImportUtils.detectFileType(state.file);
    const memoryEstimate = FileImportUtils.estimateMemoryUsage(state.file);
    const strategy = FileImportUtils.getRecommendedStrategy(state.file);

    return (
      <div className="bg-blue-50 p-4 rounded-lg mb-4">
        <h3 className="text-lg font-medium mb-2">File Information</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="font-medium">Name:</span> {state.file.name}
          </div>
          <div>
            <span className="font-medium">Size:</span> {FileImportUtils.formatFileSize(state.file.size)}
          </div>
          <div>
            <span className="font-medium">Type:</span> {fileType}
          </div>
          <div>
            <span className="font-medium">Strategy:</span> {strategy}
          </div>
          <div className="col-span-2">
            <span className="font-medium">Est. Memory:</span> {FileImportUtils.formatFileSize(memoryEstimate)}
          </div>
        </div>
      </div>
    );
  };

  const renderProgress = () => {
    if (!state.processing && state.progress === 0) return null;

    return (
      <div className="mb-4">
        <div className="flex justify-between text-sm mb-1">
          <span>Processing...</span>
          <span>{Math.round(state.progress)}%</span>
        </div>
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
          <div 
            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
            style={{ width: `${state.progress}%` }}
          />
        </div>
      </div>
    );
  };

  const renderResult = () => {
    if (!state.result) return null;

    return (
      <div className="bg-green-50 p-4 rounded-lg mb-4">
        <h3 className="text-lg font-medium mb-2 flex items-center">
          <BarChart3 className="w-5 h-5 mr-2" />
          Processing Results
        </h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="font-medium">Rows Processed:</span> {state.result.rowsProcessed.toLocaleString()}
          </div>
          <div>
            <span className="font-medium">Processing Time:</span> {Math.round(state.result.processingTime)}ms
          </div>
          <div>
            <span className="font-medium">Rows Skipped:</span> {state.result.rowsSkipped}
          </div>
          <div>
            <span className="font-medium">Strategy Used:</span> {state.result.strategy}
          </div>
          <div>
            <span className="font-medium">Errors:</span> {state.result.errors.length}
          </div>
          <div>
            <span className="font-medium">Warnings:</span> {state.result.warnings.length}
          </div>
          <div className="col-span-2">
            <span className="font-medium">Headers:</span> {state.result.metadata.headers.slice(0, 5).join(', ')}{state.result.metadata.headers.length > 5 ? '...' : ''}
          </div>
        </div>
      </div>
    );
  };

  const renderBenchmark = () => {
    if (!state.benchmark) return null;

    return (
      <div className="bg-purple-50 p-4 rounded-lg mb-4">
        <h3 className="text-lg font-medium mb-2">Benchmark Results</h3>
        <div className="space-y-2">
          {state.benchmark.results.map((result: BenchmarkResult, index: number) => (
            <div key={index} className="flex justify-between items-center p-2 bg-white dark:bg-gray-800 rounded border">
              <span className="font-medium capitalize">{result.strategy}</span>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                {result.success ? (
                  <>
                    {Math.round(result.processingTime)}ms | 
                    {Math.round(result.rowsPerSecond)} rows/s
                  </>
                ) : (
                  <span className="text-red-600">Failed: {result.error}</span>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-2 p-2 bg-yellow-100 rounded text-sm">
          <strong>Recommendation:</strong> {state.benchmark.recommendation}
        </div>
      </div>
    );
  };

  const renderLogs = () => {
    if (state.logs.length === 0) return null;

    return (
      <div className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg">
        <h3 className="text-lg font-medium mb-2 flex items-center">
          <Clock className="w-5 h-5 mr-2" />
          Processing Logs
        </h3>
        <div className="space-y-1 max-h-40 overflow-y-auto">
          {state.logs.map((log, index) => (
            <div key={index} className="text-xs font-mono text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 px-2 py-1 rounded">
              {log}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold mb-2">🚀 High-Performance File Import Demo</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Test the new Excel and CSV processing capabilities with streaming, Web Workers, and smart strategy selection
        </p>
      </div>

      {/* File Upload */}
      <div className="mb-6">
        <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-gray-300 dark:border-gray-600 border-dashed rounded-lg cursor-pointer bg-gray-50 dark:bg-gray-900 hover:bg-gray-100 dark:bg-gray-800">
          <div className="flex flex-col items-center justify-center pt-5 pb-6">
            <Upload className="w-10 h-10 mb-3 text-gray-400" />
            <p className="mb-2 text-sm text-gray-500 dark:text-gray-400">
              <span className="font-semibold">Click to upload</span> or drag and drop
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">CSV, XLSX, or XLS files</p>
          </div>
          <input
            type="file"
            className="hidden"
            accept=".csv,.xlsx,.xls"
            onChange={handleFileSelect}
          />
        </label>
      </div>

      {/* File Information */}
      {renderFileInfo()}

      {/* Action Buttons */}
      {state.file && (
        <div className="flex space-x-4 mb-6">
          <button
            onClick={handleProcess}
            disabled={state.processing}
            className="flex items-center px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            <FileText className="w-4 h-4 mr-2" />
            {state.processing ? 'Processing...' : 'Process File'}
          </button>
          <button
            onClick={handleBenchmark}
            disabled={state.processing}
            className="flex items-center px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
          >
            <Cpu className="w-4 h-4 mr-2" />
            {state.processing ? 'Benchmarking...' : 'Benchmark'}
          </button>
        </div>
      )}

      {/* Progress */}
      {renderProgress()}

      {/* Error Display */}
      {state.error && (
        <div className="bg-red-50 border border-red-200 p-4 rounded-lg mb-4">
          <h3 className="text-lg font-medium text-red-800 mb-2">Error</h3>
          <p className="text-red-700">{state.error}</p>
        </div>
      )}

      {/* Results */}
      {renderResult()}

      {/* Benchmark Results */}
      {renderBenchmark()}

      {/* Processing Logs */}
      {renderLogs()}

      {/* Features Info */}
      <div className="mt-8 bg-gray-100 dark:bg-gray-800 p-6 rounded-lg">
        <h2 className="text-xl font-bold mb-4">🎯 Enhanced Features</h2>
        <div className="grid md:grid-cols-2 gap-4 text-sm">
          <div>
            <h3 className="font-medium mb-2">Performance Optimizations:</h3>
            <ul className="space-y-1 text-gray-700 dark:text-gray-300">
              <li>• Smart processing strategy selection</li>
              <li>• Memory-efficient streaming for large files</li>
              <li>• Web Worker support for non-blocking processing</li>
              <li>• Real-time progress tracking</li>
              <li>• Automatic garbage collection triggers</li>
            </ul>
          </div>
          <div>
            <h3 className="font-medium mb-2">File Processing:</h3>
            <ul className="space-y-1 text-gray-700 dark:text-gray-300">
              <li>• PapaParse for high-speed CSV processing</li>
              <li>• ExcelJS + XLSX for comprehensive Excel support</li>
              <li>• Advanced validation and error reporting</li>
              <li>• Support for files up to 500MB</li>
              <li>• Automatic format detection</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}