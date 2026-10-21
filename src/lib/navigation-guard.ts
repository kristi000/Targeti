export const navigationGuardEvent = "targeti:before-navigation";

export function canNavigate() {
  return window.dispatchEvent(new Event(navigationGuardEvent, { cancelable: true }));
}
