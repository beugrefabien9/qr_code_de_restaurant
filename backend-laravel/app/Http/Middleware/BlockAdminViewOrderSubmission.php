<?php

namespace App\Http\Middleware;

use App\Models\ApiToken;
use App\Models\AuditLog;
use App\Models\Restaurant;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class BlockAdminViewOrderSubmission
{
    public function handle(Request $request, Closure $next): Response
    {
        $viewRestaurantId = $request->header('X-Admin-View-Restaurant');
        $plainTextToken = $request->bearerToken();

        if ($viewRestaurantId === null || ! $plainTextToken) {
            return $next($request);
        }

        $apiToken = ApiToken::with('user')
            ->where('type', 'access')
            ->where('token_hash', hash('sha256', $plainTextToken))
            ->where('expires_at', '>', now())
            ->first();

        if (! $apiToken?->user->isGlobalAdmin()) {
            return $next($request);
        }

        abort_unless(ctype_digit($viewRestaurantId), 400, 'Identifiant de restaurant invalide.');
        $restaurant = Restaurant::query()->findOrFail((int) $viewRestaurantId);

        AuditLog::create([
            'actor_id' => $apiToken->user->id,
            'restaurant_id' => $restaurant->id,
            'action' => 'admin.partner_view.public_order_blocked',
            'target_type' => Restaurant::class,
            'target_id' => $restaurant->id,
            'metadata' => ['path' => $request->path()],
        ]);

        return response()->json([
            'message' => 'Le mode de consultation administrateur ne permet pas de passer une commande.',
        ], 403);
    }
}
