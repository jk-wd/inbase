export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    if (
      typeof specifier !== 'string' ||
      !specifier.startsWith('.') ||
      /\.(ts|tsx|mjs|js|json)$/.test(specifier)
    ) {
      throw error
    }
    return nextResolve(`${specifier}.ts`, context)
  }
}
