<?php

namespace App\Http\Middleware;

use App\Models\ApiToken;
use App\Models\AuditLog;
use App\Models\Restaurant;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

class AuthenticateApiToken
{
    public function handle(Request $request, Closure $next): Response
    {
        $plainTextToken = $request->bearerToken();

        if (! $plainTextToken) {
            return response()->json(['message' => 'Authentification requise.'], 401);
        }

        $token = ApiToken::with('user')
            ->where('type', 'access')
            ->where('token_hash', hash('sha256', $plainTextToken))
            ->where('expires_at', '>', now())
            ->first();

        if (
            ! $token
            || (! $token->user->restaurant_id && $token->user->role !== 'admin')
        ) {
            return response()->json(['message' => 'Jeton invalide ou expiré.'], 401);
        }

        if ($token->user->restaurant_id && $token->user->restaurant?->status !== 'active') {
            return response()->json(['message' => 'L’accès à ce restaurant n’est pas actif.'], 403);
        }

        $token->forceFill(['last_used_at' => now()])->save();
        $authenticatedUser = $token->user;
        $viewRestaurantId = $request->header('X-Admin-View-Restaurant');
        $isAdminRoute = $request->is('api/admin/*');
        $viewRestaurant = null;

        if ($viewRestaurantId !== null && $isAdminRoute) {
            $isCloseViewRequest = $request->isMethod('post')
                && $request->is('api/admin/partner-view/close');
            abort_unless($isCloseViewRequest, 403, 'Fermez le mode de consultation avant de revenir à l’administration générale.');
        }

        if ($viewRestaurantId !== null && ! $isAdminRoute) {
            abort_unless($authenticatedUser->isGlobalAdmin(), 403, 'La consultation administrateur est réservée à l’administrateur général.');
            abort_unless(ctype_digit($viewRestaurantId), 400, 'Identifiant de restaurant invalide.');
            $viewRestaurant = Restaurant::query()->findOrFail((int) $viewRestaurantId);

            if (! in_array($request->method(), ['GET', 'HEAD'], true)) {
                AuditLog::create([
                    'actor_id' => $authenticatedUser->id,
                    'restaurant_id' => $viewRestaurant->id,
                    'action' => 'admin.partner_view.write_blocked',
                    'target_type' => Restaurant::class,
                    'target_id' => $viewRestaurant->id,
                    'metadata' => [
                        'method' => $request->method(),
                        'path' => $request->path(),
                    ],
                ]);

                return response()->json([
                    'message' => 'Le mode de consultation administrateur est en lecture seule.',
                ], 403);
            }

            $authenticatedUser = clone $authenticatedUser;
            $authenticatedUser->setAttribute('restaurant_id', $viewRestaurant->id);
            $authenticatedUser->setAttribute('role', 'partner');
            $request->attributes->set('admin_view_restaurant', $viewRestaurant);
        }

        Auth::setUser($authenticatedUser);
        $request->setUserResolver(fn () => $authenticatedUser);

        try {
            $response = $next($request);

            if ($viewRestaurant && $response->isSuccessful()) {
                AuditLog::create([
                    'actor_id' => $token->user->id,
                    'restaurant_id' => $viewRestaurant->id,
                    'action' => 'admin.partner_view.read',
                    'target_type' => Restaurant::class,
                    'target_id' => $viewRestaurant->id,
                    'metadata' => [
                        'method' => $request->method(),
                        'path' => $request->path(),
                    ],
                ]);
            }

            return $response;
        } finally {
            Auth::forgetGuards();
        }
    }
}
