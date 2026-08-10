import { Component, type ErrorInfo, type ReactNode } from 'react';

type SoftFeatureBoundaryProps = {
  name: string;
  fallback?: ReactNode;
  children: ReactNode;
};

type SoftFeatureBoundaryState = {
  failed: boolean;
};

/**
 * Ловит падения тяжёлых модулей (AR / карта / 3D) и показывает
 * базовый UI вместо краша всего приложения.
 */
export default class SoftFeatureBoundary extends Component<
  SoftFeatureBoundaryProps,
  SoftFeatureBoundaryState
> {
  state: SoftFeatureBoundaryState = { failed: false };

  static getDerivedStateFromError(): SoftFeatureBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.warn(`[P2P Audit] soft feature crash: ${this.props.name}`, error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.failed) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="soft-feature-fallback" role="status">
          <p>Модуль «{this.props.name}» недоступен на этом устройстве.</p>
          <p className="hint">Продолжайте в базовом режиме — звонки и чат работают.</p>
        </div>
      );
    }
    return this.props.children;
  }
}
