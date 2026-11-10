import { createElement, lazy, Suspense, type ComponentProps, type ComponentType } from "react";

/** Lazy-loads a component, showing `loading` until its code arrives. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches React's own lazy() typing
export default function dynamic<C extends ComponentType<any>>(
  loader: () => Promise<C>,
  options: { loading?: ComponentType } = {},
) {
  const LazyComponent = lazy(() => loader().then(component => ({ default: component })));
  const Loading = options.loading;
  function DynamicComponent(props: ComponentProps<C>) {
    return (
      <Suspense fallback={Loading ? <Loading /> : null}>
        {createElement(LazyComponent, props)}
      </Suspense>
    );
  }
  return DynamicComponent;
}
