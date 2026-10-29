import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { parse, compile } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const extensions = ['', '.ts', '.js', '.svelte', '.css', '.svg'];
// `$app/state` is read-only page state; the app shell components read the URL and page data from it.
const packages = new Set(['svelte', 'zod', '@js-temporal/polyfill', '$app/state']);
const forbiddenAPIs = new Set([
	'fetch',
	'XMLHttpRequest',
	'WebSocket',
	'EventSource',
	'sendBeacon'
]);

/** Traverse the shipped imports, including presentation components, rather than matching import text. */
function verifyBrowserGraph(
	entries: string[],
	read: (file: string) => string,
	exists: (file: string) => boolean
) {
	const visited = new Set<string>();
	function visit(file: string) {
		if (visited.has(file)) return;
		visited.add(file);
		if (!/\.(ts|js|svelte)$/.test(file)) return;
		const source = read(file);
		const scripts = file.endsWith('.svelte')
			? (() => {
					const component = parse(source, { modern: true });
					return [component.instance, component.module].flatMap((script) =>
						script
							? [
									source.slice(
										source.indexOf('>', script.start) + 1,
										source.lastIndexOf('</script', script.end)
									)
								]
							: []
					);
				})()
			: [source];
		if (file.endsWith('.svelte'))
			scripts.push(
				compile(source, { generate: 'client', filename: file }).js.code
			);
		function dependency(specifier: string) {
			if (packages.has(specifier) || specifier.startsWith('svelte/')) return;
			let target: string;
			if (specifier.startsWith('.'))
				target = path.resolve(path.dirname(file), specifier);
			else if (specifier.startsWith('#lib/'))
				target = path.join(root, 'src/lib', specifier.slice(5));
			else if (specifier.startsWith('$lib/'))
				target = path.join(root, 'src/lib', specifier.slice(5));
			else
				throw new Error(
					`Nonlocal or unapproved dependency: ${specifier} in ${file}`
				);
			const relative = path.relative(root, target).replaceAll(path.sep, '/');
			if (!relative.startsWith('src/lib/'))
				throw new Error(`Live or server dependency: ${specifier}`);
			if (relative.includes('/server/') || /\.(server|test)\./.test(relative))
				throw new Error(`Server/test dependency: ${specifier}`);
			const resolved = extensions
				.map((extension) => target + extension)
				.find(exists);
			if (!resolved) throw new Error(`Unresolved dependency: ${specifier}`);
			visit(resolved);
		}
		for (const script of scripts) {
			const parsed = ts.createSourceFile(
				file + '.ts',
				script,
				ts.ScriptTarget.Latest,
				true,
				ts.ScriptKind.TS
			);
			function walk(node: ts.Node) {
				if (ts.isIdentifier(node) && forbiddenAPIs.has(node.text))
					throw new Error(`Network API ${node.text} in ${file}`);
				if (
					ts.isElementAccessExpression(node) &&
					ts.isStringLiteral(node.argumentExpression) &&
					forbiddenAPIs.has(node.argumentExpression.text)
				)
					throw new Error(
						`Network API ${node.argumentExpression.text} in ${file}`
					);
				if (
					(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
					node.moduleSpecifier &&
					ts.isStringLiteral(node.moduleSpecifier)
				)
					dependency(node.moduleSpecifier.text);
				if (
					ts.isCallExpression(node) &&
					node.expression.kind === ts.SyntaxKind.ImportKeyword
				) {
					const specifier = node.arguments[0];
					if (!specifier || !ts.isStringLiteral(specifier))
						throw new Error(`Computed import in ${file}`);
					dependency(specifier.text);
				}
				ts.forEachChild(node, walk);
			}
			walk(parsed);
		}
	}
	for (const entry of entries) visit(entry);
	return visited;
}

describe('public sample publishing boundary', () => {
	it('follows the actual landing graph without live clients, server publishing, or network APIs', () => {
		const files = verifyBrowserGraph(
			[path.join(root, 'src/lib/views/PublicHome.svelte')],
			(file) => readFileSync(file, 'utf8'),
			existsSync
		);
		expect(files.has(path.join(root, 'src/lib/demo/store.ts'))).toBe(true);
		expect(files.has(path.join(root, 'src/lib/domain/scheduling.ts'))).toBe(
			true
		);
		expect(files.has(path.join(root, 'src/lib/components/Post.svelte'))).toBe(
			true
		);
	});
	it.each([
		"import { ConvexClient } from 'convex/browser';",
		"import '#lib/server/convex.ts';",
		"import '../../../convex/_generated/api';",
		"import('$lib/server/postActions');",
		"fetch('/publish', { method: 'POST' });",
		"window['fetch']('/publish');",
		"navigator.sendBeacon('/publish');",
		'import(destination);'
	])('rejects a forbidden dependency or network action: %s', (source) => {
		const entry = path.join(root, 'src/lib/demo/guard-fixture.ts');
		expect(() =>
			verifyBrowserGraph(
				[entry],
				() => source,
				() => true
			)
		).toThrow();
	});
	it('follows transitive dependencies before allowing a presentation component', () => {
		const entry = path.join(root, 'src/lib/demo/guard-fixture.ts');
		expect(() =>
			verifyBrowserGraph(
				[entry],
				(file) =>
					file === entry
						? "import './nested.ts';"
						: "import { api } from '../../../convex/_generated/api';",
				() => true
			)
		).toThrow();
	});
});

// Network calls inside template handlers must obey the same boundary as script imports.
it('rejects a network action in a Svelte event handler', () => {
	const entry = path.join(root, 'src/lib/demo/guard-fixture.svelte');
	expect(() =>
		verifyBrowserGraph(
			[entry],
			() =>
				'<button onclick={() => fetch("/publish", { method: "POST" })}>Publish</button>',
			() => true
		)
	).toThrow('Network API fetch');
});
