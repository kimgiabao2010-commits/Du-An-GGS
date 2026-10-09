# Pass a reviewed digest-pinned Node 22 Linux image through --build-arg NODE_IMAGE.
ARG NODE_IMAGE
FROM ${NODE_IMAGE}
WORKDIR /opt/gss
COPY package.json package-lock.json tsconfig.json ./
COPY packages/ ./packages/
COPY services/ ./services/
COPY scripts/ ./scripts/
COPY apps/standalone/package.json ./apps/standalone/package.json
RUN npm ci --ignore-scripts && npm run build --workspace=@asq/sdk
USER 10000:10000
WORKDIR /workspace
ENTRYPOINT []
CMD ["node", "--version"]
