/**
 * Lume JS API types (M1 surface — grows in M2/M3).
 */

declare namespace lume.ui {
  interface Style {
    background?: string;
    color?: string;
    fontSize?: number;
    padding?: number;
  }

  interface ViewProps { id?: string; style?: Style; children?: Node[] }
  interface TextProps { id?: string; text: string; style?: Style }
  interface ButtonProps { id?: string; title: string; onPress: () => void }

  type Node = { kind: 'view'; props: ViewProps }
            | { kind: 'text'; props: TextProps }
            | { kind: 'button'; props: ButtonProps };

  function View(props: ViewProps, children?: Node[]): Node & { setState(id: string, patch: object): void };
  function Text(props: TextProps): Node;
  function Button(props: ButtonProps): Node;
}

declare namespace lume.system {
  function log(msg: string): void;
}

declare namespace lume {
  const ui: typeof lume.ui;
  const system: typeof lume.system;
  function start(root: lume.ui.Node): void;
}
