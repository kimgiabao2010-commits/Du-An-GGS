"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.metadata = void 0;
exports.default = RootLayout;
require("./globals.css");
exports.metadata = {
    title: 'ASQ-Engine Central',
    description: 'Autonomous SecOps & AI Reasoning Dashboard',
};
function RootLayout({ children, }) {
    return (<html lang="en">
      <body>
        <main style={{ padding: '2rem' }}>
          {children}
        </main>
      </body>
    </html>);
}
//# sourceMappingURL=layout.js.map