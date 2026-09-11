// app/core/services/index.ts

export type { TAdapterRegistry, TAdapterPicker, ICoreUseCases } from './core_services.class';
export { CoreServices, defaultAdapterPicker } from './core_services.class';
export type { ICreateCoreServicesOptions } from './create_core_services.factory';
export { createCoreServices } from './create_core_services.factory';
