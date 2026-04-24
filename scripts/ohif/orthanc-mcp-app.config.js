/** @type {AppTypes.Config} */
window.config = {
  routerBasename: '/ohif',
  extensions: [],
  modes: [],
  showStudyList: false,
  maxNumberOfWebWorkers: 3,
  showLoadingIndicator: true,
  showWarningMessageForCrossOrigin: false,
  showCPUFallbackMessage: true,
  strictZSpacingForVolumeViewport: true,
  defaultDataSourceName: 'orthanc',
  dataSources: [
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'orthanc',
      configuration: {
        friendlyName: 'Orthanc demo via MCP proxy',
        name: 'orthanc-demo',
        wadoUriRoot: 'https://orthanc-mcp-app.fly.dev/dicomweb/orthanc-demo',
        qidoRoot: 'https://orthanc-mcp-app.fly.dev/dicomweb/orthanc-demo',
        wadoRoot: 'https://orthanc-mcp-app.fly.dev/dicomweb/orthanc-demo',
        qidoSupportsIncludeField: false,
        supportsReject: false,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
        omitQuotationForMultipartRequest: true,
        bulkDataURI: {
          enabled: true,
        },
      },
    },
  ],
  httpErrorHandler: error => {
    console.warn('[OHIF]', error.status);
  },
};
