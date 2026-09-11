import * as fs from 'fs';
import * as path from 'path';

/**
 * ASQ-Engine Architecture & Guardrails Integrity Auditor
 * Quét toàn bộ thư mục dự án để phát hiện sớm các sai lệch kiến trúc và bảo vệ định hướng gốc.
 */
const REQUIRED_COMPONENTS = [
  // 1. Core Documentation
  { path: 'IMPLEMENTATION_PLAN.md', type: 'file', role: 'Bản đặc tả kiến trúc gốc V4' },
  { path: 'README.md', type: 'file', role: 'Hướng dẫn tổng quan dự án' },

  // 2. Pillar 1: SDK & Security Fabric
  { path: 'packages/sdk/src/types/index.ts', type: 'file', role: 'UDM & Shared Data Contracts' },
  { path: 'packages/sdk/src/security/token-signer.ts', type: 'file', role: 'Cryptographic Signed Tokens & RBAC' },
  { path: 'packages/sdk/src/transport/event-bus.ts', type: 'file', role: 'Distributed Event Bus Fabric' },

  // 3. Safety Guardrails & FinOps
  { path: 'packages/guardrails/src/sanitizer/log-sanitizer.ts', type: 'file', role: 'Anti-Prompt-Injection Sanitizer' },
  { path: 'packages/guardrails/src/finops/token-bucket.ts', type: 'file', role: 'FinOps 2-Layer Quota Controller' },
  { path: 'packages/guardrails/src/adversarial/red-team-verifier.ts', type: 'file', role: 'Dual-LLM Red-Team Verifier' },
  { path: 'packages/guardrails/src/canary/rollback-guard.ts', type: 'file', role: 'Canary Deployment & 0-Sec Rollback Guard' },

  // 4. Pillar 2: Standalone Command Center
  { path: 'services/standalone/src/ingestion/siem-receiver.ts', type: 'file', role: 'SIEM Log Ingestion Hub' },
  { path: 'services/standalone/src/assessment/blast-radius.ts', type: 'file', role: 'Blast Radius Assessment Engine' },
  { path: 'services/standalone/src/autonomy/progressive-controller.ts', type: 'file', role: 'Progressive Autonomy Engine (Level 1/2/3)' },
  { path: 'services/standalone/src/killswitch/emergency-switch.ts', type: 'file', role: 'Emergency Kill-Switch Protocol' },

  // 5. Pillar 3: IDE Semantic & Reasoning Engine
  { path: 'services/ide-reasoning/src/router/model-router.ts', type: 'file', role: 'Model Tiering Router (Tier 1/2/3)' },
  { path: 'services/ide-reasoning/src/ast/ast-parser.ts', type: 'file', role: 'AST Semantic & IaC Parser' },
  { path: 'services/ide-reasoning/src/remediation/patch-generator.ts', type: 'file', role: 'Code Diff & YARA-L Patch Generator' },

  // 6. Pillar 4: CLI Sandboxed Worker
  { path: 'services/cli-worker/src/sandbox/ephemeral-runner.ts', type: 'file', role: 'Ephemeral Container Runner' },
  { path: 'services/cli-worker/src/scanners/network-recon.ts', type: 'file', role: 'Nmap & CVE Recon Scanner' },
  { path: 'services/cli-worker/src/scanners/sast-scanner.ts', type: 'file', role: 'Semgrep & Trivy SAST Scanner' },
  { path: 'services/cli-worker/src/gitops/pr-dispatcher.ts', type: 'file', role: 'GitOps PR Dispatcher & Verifier' },

  // 7. E2E Test Suite
  { path: 'tests/e2e/test_closed_loop.ts', type: 'file', role: '5-Step Closed-Loop Integration Test' }
];

function auditProjectArchitecture(baseDir: string = process.cwd()) {
  console.log('================================================================');
  console.log('🔍 BẮT ĐẦU QUÉT KIỂM TRA ĐỊNH HƯỚNG KIẾN TRÚC DỰ ÁN (ASQ-ENGINE)');
  console.log(`📁 Thư mục kiểm toán: ${baseDir}`);
  console.log('================================================================\n');

  let passedCount = 0;
  let missingCount = 0;

  for (const comp of REQUIRED_COMPONENTS) {
    const fullPath = path.join(baseDir, comp.path);
    const exists = fs.existsSync(fullPath);

    if (exists) {
      console.log(`✅ [CHUẨN ĐỊNH HƯỚNG] ${comp.path.padEnd(55)} -> ${comp.role}`);
      passedCount++;
    } else {
      console.error(`❌ [LỆCH KIẾN TRÚC / THIẾU] ${comp.path.padEnd(55)} -> ${comp.role}`);
      missingCount++;
    }
  }

  console.log('\n----------------------------------------------------------------');
  console.log(`📊 TỔNG KẾT KIỂM TOÁN KIẾN TRÚC:`);
  console.log(`- Tổng số thành phần tiêu chuẩn: ${REQUIRED_COMPONENTS.length}`);
  console.log(`- Thành phần đạt chuẩn:          ${passedCount} (${((passedCount / REQUIRED_COMPONENTS.length) * 100).toFixed(1)}%)`);
  console.log(`- Thành phần thiếu sót:          ${missingCount}`);
  console.log('----------------------------------------------------------------');

  if (missingCount === 0) {
    console.log('🎉 TOÀN BỘ CẤU TRÚC DỰ ÁN ĐANG BÁM SÁT 100% ĐỊNH HƯỚNG ASQ-ENGINE V4!\n');
  } else {
    console.warn(`⚠️ CẢNH BÁO: Phát hiện ${missingCount} thành phần bị thiếu hoặc sai lệch.\n`);
  }
}

auditProjectArchitecture(process.cwd());
