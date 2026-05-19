import { Server, ServiceDefinition, UntypedServiceImplementation } from '@grpc/grpc-js'

export type WithoutIndexSignature<T> = {
  [K in keyof T as string extends K ? never : K]: T[K]
}

/**
 * Strip the "untypedness" from a type defined from UntypedServiceImplementation so we can
 * actually build our class.
 * @public
 */
export type TypedServiceImplementation<T extends UntypedServiceImplementation> =
  WithoutIndexSignature<T> // & { service: ServiceDefinition}

/*
export class GRPCServer extends Server {

    addTypedService<U extends UntypedServiceImplementation>(
        implementation: TypedServiceImplementation<U>
    ) {
        this.addService(implementation.service, implementation as unknown as UntypedServiceImplementation);
    }
}*/

/**
 * Add a gRPC service with a fully typed implementation to the server.
 *
 * This is needed because grpc-js requires UntypedServerImplementation objects.  ts-proto
 * generates typed interfaces that extend UntypedServiceImplementation, but since
 * UntypedServerImplementation requires a [name: string]: UntypedHandleCall member variable
 * any implementation of the generated classes cannot contain additional methods or variables.
 *
 * This is silly, so we implement TypedServiceImplementation classes (see above) and use this
 * to add them without a bunch of ugly casting in our code.
 *
 * When an assertion function is provided, the loaded value is validated and returned as type `T`.
 * @public
 */
export function addTypedService<U extends UntypedServiceImplementation>(
  server: Server,
  service: ServiceDefinition,
  implementation: TypedServiceImplementation<U>,
) {
  server.addService(service, implementation as unknown as UntypedServiceImplementation)
}
