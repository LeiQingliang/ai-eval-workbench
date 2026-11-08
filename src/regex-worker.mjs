import { parentPort, workerData } from 'node:worker_threads';
try {
  parentPort.postMessage({ passed: new RegExp(workerData.pattern, workerData.flags).test(workerData.text) });
} catch (error) {
  parentPort.postMessage({ error: error.message });
}
