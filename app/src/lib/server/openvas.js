import net from 'node:net';
import { env } from '$env/dynamic/private';

// Well-known built-in OpenVAS scan config: "Full and fast".
const FULL_AND_FAST_CONFIG_ID = 'daba56c8-73ec-11df-a475-002264764cea';

function config() {
	const host = env.OPENVAS_GMP_HOST;
	const port = Number(env.OPENVAS_GMP_PORT);
	const username = env.OPENVAS_GMP_USERNAME;
	const password = env.OPENVAS_GMP_PASSWORD;
	if (!host || !port || !username || !password) {
		throw new Error(
			'ยังไม่ได้ตั้งค่า OPENVAS_GMP_HOST / OPENVAS_GMP_PORT / OPENVAS_GMP_USERNAME / OPENVAS_GMP_PASSWORD'
		);
	}
	return { host, port, username, password };
}

/**
 * Send a sequence of GMP XML commands over one authenticated session
 * (a single TCP connection, matching gvmd's session-based protocol) and
 * return each command's raw XML response.
 * @param {string[]} commands
 * @returns {Promise<string[]>}
 */
function gmpSession(commands) {
	const { host, port, username, password } = config();
	const authCmd = `<authenticate><credentials><username>${escapeXml(username)}</username><password>${escapeXml(password)}</password></credentials></authenticate>`;
	const allCommands = [authCmd, ...commands];

	return new Promise((resolve, reject) => {
		const socket = net.createConnection({ host, port });
		const responses = [];
		let buffer = '';
		let commandIndex = 0;
		let settled = false;

		const timer = setTimeout(() => {
			if (!settled) {
				settled = true;
				socket.destroy();
				reject(new Error('GMP session timed out'));
			}
		}, 60000);

		function sendNext() {
			if (commandIndex >= allCommands.length) {
				settled = true;
				clearTimeout(timer);
				socket.end();
				resolve(responses);
				return;
			}
			socket.write(allCommands[commandIndex]);
		}

		socket.on('connect', sendNext);

		socket.on('data', (chunk) => {
			buffer += chunk.toString('utf-8');
			const complete = extractCompleteXml(buffer);
			if (complete === null) return;
			responses.push(complete);
			buffer = '';
			commandIndex += 1;
			sendNext();
		});

		socket.on('error', (err) => {
			if (!settled) {
				settled = true;
				clearTimeout(timer);
				reject(err);
			}
		});

		socket.on('close', () => {
			if (!settled) {
				settled = true;
				clearTimeout(timer);
				reject(new Error('GMP connection closed before all responses were received'));
			}
		});
	});
}

/** Returns the buffered XML once its root element's tags balance out, else null. */
function extractCompleteXml(buffer) {
	const rootMatch = buffer.match(/^\s*<([a-zA-Z0-9_]+)/);
	if (!rootMatch) return null;
	const tag = rootMatch[1];
	const openCount = (buffer.match(new RegExp(`<${tag}(\\s|>)`, 'g')) ?? []).length;
	const closeCount = (buffer.match(new RegExp(`</${tag}>`, 'g')) ?? []).length;
	if (openCount > 0 && openCount === closeCount) return buffer;
	return null;
}

function escapeXml(str) {
	return String(str).replace(/[<>&'"]/g, (c) =>
		({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]
	);
}

function attr(xml, tag, attrName) {
	const m = xml.match(new RegExp(`<${tag}[^>]*\\s${attrName}="([^"]*)"`));
	return m ? m[1] : null;
}

/**
 * Create a target + task against it using the "Full and fast" scan config,
 * then start the task.
 * @param {string} name
 * @param {string} targets comma-separated IPs/hostnames
 * @returns {Promise<{ taskId: string }>}
 */
export async function createAndLaunchScan(name, targets) {
	const createTargetCmd = `<create_target><name>${escapeXml(name)}</name><hosts>${escapeXml(targets)}</hosts></create_target>`;
	const [, targetRes] = await gmpSession([createTargetCmd]);
	const targetId = attr(targetRes, 'create_target_response', 'id');
	if (!targetId) throw new Error(`สร้าง target ไม่สำเร็จ: ${targetRes}`);

	const createTaskCmd = `<create_task><name>${escapeXml(name)}</name><config id="${FULL_AND_FAST_CONFIG_ID}"/><target id="${targetId}"/></create_task>`;
	const [, taskRes] = await gmpSession([createTaskCmd]);
	const taskId = attr(taskRes, 'create_task_response', 'id');
	if (!taskId) throw new Error(`สร้าง task ไม่สำเร็จ: ${taskRes}`);

	await gmpSession([`<start_task task_id="${taskId}"/>`]);

	return { taskId };
}

/**
 * @param {string} taskId
 * @returns {Promise<{ status: string, reportId: string|null }>}
 */
export async function getScanStatus(taskId) {
	const [, res] = await gmpSession([`<get_tasks task_id="${taskId}"/>`]);
	const status = res.match(/<status>([^<]*)<\/status>/)?.[1] ?? 'Unknown';
	const reportId =
		res.match(/<last_report>\s*<report id="([^"]*)"/)?.[1] ??
		res.match(/<current_report>\s*<report id="([^"]*)"/)?.[1] ??
		null;
	return { status, reportId };
}

/**
 * Fetch the raw results of a finished report.
 * @param {string} reportId
 * @returns {Promise<string>} raw GMP XML for the report
 */
export async function getReportXml(reportId) {
	const [, res] = await gmpSession([
		`<get_reports report_id="${reportId}" details="1" ignore_pagination="1"/>`
	]);
	return res;
}
