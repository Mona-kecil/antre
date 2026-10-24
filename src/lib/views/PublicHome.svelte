<script lang="ts">
	import Post from '../components/Post.svelte';
	import Icon from '../components/Icon.svelte';
	import DemoTimeline from '../demo/DemoTimeline.svelte';
	const settings = {
		windows: [
			{ start: '09:00', end: '12:00' },
			{ start: '16:00', end: '18:00' }
		],
		intervalMinutes: 30,
		timeZone: 'Asia/Jakarta'
	};
	const morning = Date.UTC(2026, 9, 24, 2);
	const preview = [
		{ id: 'first', at: morning, kind: 'queued' },
		{ id: 'second', at: morning + 3600000, kind: 'queued' },
		{ id: 'third', at: morning + 7 * 3600000, kind: 'queued' }
	];
</script>

<svelte:head>
	<title>Antre · A place for your next post</title>
	<meta
		name="description"
		content="Write, review, and schedule posts for Threads and LinkedIn. Try Antre with a browser-local demo, then start your own workspace."
	/>
</svelte:head>

<div class="public-home" data-sveltekit-reload>
	<header class="masthead">
		<a class="wordmark" href="/" aria-label="Antre home"
			>antre<span aria-hidden="true">.</span></a
		>
		<nav aria-label="Account">
			<a class="signin" href="/login">Sign in</a><a
				class="btn btn-secondary"
				href="/login?screen_hint=sign-up">Create account</a
			>
		</nav>
	</header>
	<main>
		<section class="intro" aria-labelledby="home-title">
			<div class="copy">
				<h1 id="home-title">A place for your next post.</h1>
				<p class="lede">
					Write it down. Give it a second look. Find its place in the day.
				</p>
				<p class="description">
					Antre holds your drafts and schedules the posts you approve for
					Threads and LinkedIn. Each channel has its own queue and posting
					rhythm.
				</p>
				<div class="calls">
					<a class="btn btn-primary" href="/demo"
						>Try the demo <Icon name="right" size={16} /></a
					><a class="account-link" href="/login?screen_hint=sign-up"
						>Create your account</a
					>
				</div>
				<p class="demo-note">
					No account needed to explore. Nothing posts online.
				</p>
			</div>
			<div
				class="product"
				aria-label="Antre schedule preview with sample posts"
			>
				<div class="preview-bar">
					<strong>Schedule</strong><span
						>Threads <Icon name="down" size={14} /></span
					>
				</div>
				<div class="day">
					<strong>Saturday, October 24</strong><span>Sample · Jakarta</span>
				</div>
				<DemoTimeline
					day="2026-10-24"
					{settings}
					posts={preview}
					next={morning + 1800000}
				/>
				<Post
					username="mira.sample"
					parts={[
						{
							text: 'A small rule for making things: leave the next person a clear place to start.'
						},
						{
							text: 'Name the draft. Write down the open question. Put the next step where they can see it.'
						}
					]}
				>
					{#snippet head()}<span class="preview-time">09:00</span>{/snippet}
					{#snippet sub()}<span class="preview-label">Queued · sample post</span
						>{/snippet}
					<span class="preview-action"
						><Icon name="clock" size={16} /> Move</span
					><span class="preview-action"
						><Icon name="edit" size={16} /> Edit</span
					>
				</Post>
				<Post
					username="mira.sample"
					parts={[
						{
							text: 'The first version gives you something to ask better questions about. Make it small. Put it in someone’s hands.'
						}
					]}
				>
					{#snippet head()}<span class="preview-time">10:00</span>{/snippet}
					{#snippet sub()}<span class="preview-label">Queued · sample post</span
						>{/snippet}
				</Post>
				<a class="preview-bottom" href="/demo"
					>Make room for your ideas <Icon name="right" size={16} /></a
				>
			</div>
		</section>
		<section class="explanation" aria-labelledby="workflow-title">
			<h2 id="workflow-title">From a rough thought to a post.</h2>
			<div class="workflow">
				<p>
					<strong>Keep the whole thought.</strong> Write a short post or build a Threads
					conversation, one part at a time.
				</p>
				<p>
					<strong>See the day take shape.</strong> Queue the next slot, choose a time,
					or move a post when plans change.
				</p>
				<p>
					<strong>Start with your own space.</strong> Create an account for an empty
					workspace. Demo posts stay in your browser.
				</p>
			</div>
		</section>
	</main>
	<footer>
		<a class="wordmark small" href="/">antre.</a>
		<p>Draft. Review. Make room.</p>
		<a href="/privacy">Privacy</a>
	</footer>
</div>

<style>
	.public-home {
		max-width: 1120px;
		margin: 0 auto;
		padding: 0 24px;
	}
	.masthead {
		height: 88px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
	}
	.wordmark {
		font-size: 32px;
		font-weight: 750;
		letter-spacing: -0.04em;
		text-decoration: none;
	}
	nav {
		display: flex;
		align-items: center;
		gap: 24px;
		font-size: 13px;
		font-weight: 600;
	}
	.signin {
		text-decoration: none;
	}
	.intro {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.14fr);
		align-items: center;
		gap: 64px;
		padding: 64px 0 80px;
	}
	h1 {
		max-width: 9ch;
		font-size: clamp(40px, 5vw, 60px);
		font-weight: 700;
		letter-spacing: -0.04em;
		line-height: 1.06;
		text-wrap: balance;
	}
	.lede {
		margin-top: 24px;
		font-size: 20px;
		line-height: 1.45;
		max-width: 27ch;
		text-wrap: pretty;
	}
	.description {
		margin-top: 20px;
		max-width: 39ch;
		color: var(--fg-2);
		line-height: 1.6;
	}
	.calls {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 16px;
		margin-top: 28px;
	}
	.calls .btn {
		height: 44px;
		padding-inline: 20px;
	}
	.account-link {
		font-weight: 600;
		font-size: 13px;
	}
	.demo-note {
		margin-top: 12px;
		font-size: 12px;
		color: var(--fg-2);
	}
	.product {
		border: 1px solid var(--line-2);
		border-radius: 16px;
		overflow: hidden;
		min-width: 0;
	}
	.preview-bar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		height: 60px;
		padding: 0 16px;
		border-bottom: 1px solid var(--line);
	}
	.preview-bar strong {
		font-size: 20px;
		letter-spacing: -0.02em;
	}
	.preview-bar > span {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
	}
	.day {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
		padding: 16px 16px 0;
		font-size: 13px;
		flex-wrap: wrap;
	}
	.day > span,
	.preview-label,
	.preview-time {
		font-size: 12px;
		color: var(--fg-2);
	}
	.preview-time {
		margin-left: auto;
		font-variant-numeric: tabular-nums;
	}
	.preview-action {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin-right: 20px;
		min-height: 32px;
		font-size: 13px;
		color: var(--fg-2);
	}
	.preview-bottom {
		display: flex;
		justify-content: center;
		align-items: center;
		gap: 8px;
		min-height: 48px;
		font-size: 13px;
		font-weight: 600;
		text-decoration: none;
	}
	.preview-bottom:hover {
		background: var(--press);
	}
	.explanation {
		border-top: 1px solid var(--line);
		padding: 40px 0 56px;
	}
	h2 {
		font-size: 24px;
		letter-spacing: -0.02em;
	}
	.workflow {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 40px;
		margin-top: 24px;
	}
	.workflow p {
		color: var(--fg-2);
		line-height: 1.6;
	}
	.workflow strong {
		display: block;
		color: var(--fg);
		margin-bottom: 6px;
		font-weight: 600;
	}
	footer {
		display: flex;
		gap: 20px;
		align-items: center;
		border-top: 1px solid var(--line);
		padding: 24px 0 calc(24px + var(--safe-b));
		color: var(--fg-2);
		font-size: 12px;
	}
	.small {
		font-size: 20px;
		color: var(--fg);
	}
	footer > a:last-child {
		margin-left: auto;
	}
	@media (max-width: 800px) {
		.intro {
			gap: 32px;
		}
		.workflow {
			gap: 24px;
		}
	}
	@media (max-width: 640px) {
		.public-home {
			padding-inline: 20px;
		}
		.masthead {
			height: 72px;
		}
		nav {
			gap: 16px;
		}
		nav .btn {
			padding-inline: 12px;
			font-size: 13px;
		}
		.intro {
			grid-template-columns: 1fr;
			gap: 40px;
			padding: 32px 0 40px;
		}
		h1 {
			font-size: 48px;
			max-width: 10ch;
		}
		.lede {
			font-size: 20px;
			max-width: 30ch;
		}
		.description {
			max-width: 42ch;
		}
		.product {
			margin-inline: -4px;
		}
		.workflow {
			grid-template-columns: 1fr;
			gap: 24px;
			max-width: 42ch;
		}
		.explanation {
			padding-top: 32px;
		}
	}
	@media (max-width: 360px) {
		.public-home {
			padding-inline: 16px;
		}
		.wordmark {
			font-size: 24px;
		}
		nav {
			gap: 10px;
		}
		h1 {
			font-size: 40px;
		}
		footer p {
			display: none;
		}
	}
</style>
