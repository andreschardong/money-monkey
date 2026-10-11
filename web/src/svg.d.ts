// SVG icons are bundled as text (see the ".svg" loader in angular.json).
declare module '*.svg' {
  const content: string;
  export default content;
}
