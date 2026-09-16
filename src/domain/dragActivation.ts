export const WEB_DRAG_ACTIVATION_DELAY_MS = 120;
export const NATIVE_DRAG_ACTIVATION_DELAY_MS = 320;

export const dragActivationDelay = (isWeb: boolean) => isWeb ? WEB_DRAG_ACTIVATION_DELAY_MS : NATIVE_DRAG_ACTIVATION_DELAY_MS;
