<script lang="ts">
	import { page } from '$app/state';
	import Workspace from '../demo/Workspace.svelte';
	import Icon from '../components/Icon.svelte';

	const mcp = `${page.url.origin}/mcp`;

	const tools = [
		['create_draft', 'Saves a Threads draft for your review'],
		['set_taxonomy', 'Edits the topics, angles and formats drafts are tagged with'],
		['queue', 'Puts a post in the next free slot or at an exact time'],
		['draft_reply', 'Saves a draft answer to a reply. It never sends'],
		['insights', 'Reads views and engagement by topic']
	];
</script>

<svelte:head>
	<title>Antre · Your agent drafts. You plan the week.</title>
	<meta
		name="description"
		content="Antre is the review queue between your agent and your Threads and LinkedIn. Drafts arrive over MCP, tagged; you queue, schedule, or edit each one."
	/>
</svelte:head>

<div class="home" data-sveltekit-reload>
	<header class="masthead">
		<a class="brand" href="/" aria-label="Antre home"
			><span class="mark" aria-hidden="true"><i></i><i></i><i></i></span>antre</a
		>
		<nav aria-label="Account">
			<a class="signin" href="/login">Sign in</a>
			<a class="btn btn-secondary" href="/login?screen_hint=sign-up">Create account</a>
		</nav>
	</header>

	<main>
		<section class="intro" aria-labelledby="home-title">
			<h1 id="home-title">Your agent drafts.<br />You plan the week.</h1>
			<div class="pitch">
				<p>Antre is the review queue between your agent and your Threads and LinkedIn.</p>
				<div class="calls">
					<a class="btn btn-primary" href="/login?screen_hint=sign-up">Create account <Icon name="right" size={16} /></a>
					<a class="btn btn-secondary" href="#sample">Try the sample</a>
				</div>
			</div>
		</section>

		<Workspace />

		<section class="connect" aria-labelledby="connect-title">
			<div class="copy">
				<h2 id="connect-title">Connect your agent.</h2>
				<p>
					Create an agent key in Settings, then add Antre to Claude Code or any MCP client. What it
					writes lands in Drafts.
				</p>
				<p class="muted">
					A key can also queue, publish, and delete posts, and send replies. Revoke it in Settings to
					stop its next request.
				</p>
			</div>
			<div class="setup">
				<pre><code
						>claude mcp add --transport http antre \
  {mcp} \
  --header "Authorization: Bearer $ANTRE_KEY"</code
					></pre>
				<dl>
					{#each tools as [name, does]}
						<div>
							<dt><code>{name}</code></dt>
							<dd>{does}</dd>
						</div>
					{/each}
				</dl>
			</div>
		</section>

		<section class="close" aria-labelledby="close-title">
			<h2 id="close-title">Plan your own week.</h2>
			<p class="muted">The sample above stays in this tab and never posts.</p>
			<div class="calls">
				<a class="btn btn-primary" href="/login?screen_hint=sign-up">Create account <Icon name="right" size={16} /></a>
			</div>
		</section>
	</main>

	<footer>
		<a class="brand small" href="/" aria-label="Antre home"
			><span class="mark" aria-hidden="true"><i></i><i></i><i></i></span>antre</a
		>
		<a href="/privacy">Privacy</a>
	</footer>
</div>

<style>
	.home {
		--gutter: clamp(20px, 4vw, 48px);
	}

	.masthead,
	.intro,
	.connect,
	.close,
	footer {
		max-width: 1344px;
		margin-inline: auto;
		padding-inline: var(--gutter);
	}

	.masthead {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		height: 72px;
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 20px;
		font-weight: 650;
		letter-spacing: -0.03em;
		text-decoration: none;
	}

	.mark {
		display: flex;
		align-items: end;
		gap: 2.5px;
		height: 18px;
	}

	.mark i {
		width: 4px;
		height: 10px;
		border-radius: 2px;
		background: currentColor;
	}

	.mark i:nth-child(2) {
		height: 17px;
	}

	.mark i:nth-child(3) {
		height: 13px;
	}

	.masthead nav {
		display: flex;
		align-items: center;
		gap: 20px;
		font-size: 15px;
		font-weight: 600;
	}

	.signin {
		text-decoration: none;
	}

	.signin:hover {
		text-decoration: underline;
	}

	.intro {
		display: grid;
		grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
		align-items: end;
		gap: 24px 64px;
		padding-block: 56px 48px;
	}

	h1 {
		font-size: clamp(40px, 4.4vw, 60px);
		font-weight: 700;
		line-height: 1.04;
		letter-spacing: -0.04em;
	}

	.pitch p {
		max-width: 42ch;
		font-size: 17px;
		line-height: 1.5;
		color: var(--fg-2);
		text-wrap: pretty;
	}

	.calls {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		margin-top: 24px;
	}

	.calls .btn {
		height: 44px;
		padding-inline: 20px;
	}

	.connect {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr);
		gap: 40px 64px;
		padding-block: 96px;
	}

	h2 {
		font-size: 24px;
		line-height: 1.15;
		letter-spacing: -0.03em;
	}

	.copy p {
		max-width: 44ch;
		margin-top: 16px;
		line-height: 1.55;
		text-wrap: pretty;
	}

	.copy p.muted {
		font-size: 13px;
	}

	pre {
		margin: 0;
		padding: 16px 18px;
		overflow-x: auto;
		border-radius: 10px;
		background: var(--bg-2);
		font-size: 13px;
		line-height: 1.6;
	}

	code {
		font-family: ui-monospace, monospace;
	}

	dl {
		margin: 20px 0 0;
	}

	dl div {
		display: grid;
		grid-template-columns: 136px minmax(0, 1fr);
		gap: 12px;
		padding: 10px 0;
		border-bottom: 1px solid var(--line);
		font-size: 13px;
		line-height: 18px;
	}

	dt code {
		font-size: 12.5px;
	}

	dd {
		margin: 0;
		color: var(--fg-2);
	}

	.close {
		padding-block: 32px 112px;
	}

	.close p {
		margin-top: 10px;
	}

	footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding-block: 24px calc(24px + var(--safe-b));
		border-top: 1px solid var(--line);
		font-size: 13px;
		color: var(--fg-2);
	}

	.small {
		font-size: 17px;
		color: var(--fg);
	}

	.small .mark {
		height: 15px;
		transform: scale(0.85);
		transform-origin: left bottom;
	}

	@media (max-width: 800px) {
		.intro,
		.connect {
			grid-template-columns: minmax(0, 1fr);
		}

		.intro {
			padding-block: 32px 40px;
		}

		.connect {
			padding-block: 64px;
		}

		.close {
			padding-block: 8px 72px;
		}
	}

	@media (max-width: 480px) {
		.masthead nav .btn {
			display: none;
		}

		.calls .btn {
			flex: 1;
		}

		dl div {
			grid-template-columns: minmax(0, 1fr);
			gap: 2px;
		}
	}
</style>
